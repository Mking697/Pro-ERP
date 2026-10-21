import { and, desc, eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { db } from "@/db/client";
import { savedViews } from "@/db/schema";
import { insertRecord } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { normalizeSavedViewInput } from "@/lib/savedViews/validation";

/**
 * "Saved Views/Filters" (roadmap Phase 3 item #12) — persistence for
 * src/components/saved-views-bar.tsx, the reusable "Views" dropdown wired into both
 * OrdersBoard and InventoryBoard (and any future module that adopts it).
 *
 * Private-to-owner by design (see src/db/schema/savedViews.ts's own doc comment): every
 * function here takes `userId` and filters by it, never by `orgId` alone — a saved view
 * never leaks across users in the same org, mirroring src/lib/chatbot/sessions.ts's own
 * "a session is private to whoever started it" convention exactly.
 */
export interface SavedViewRecord {
  id: string;
  module: string;
  name: string;
  filters: Record<string, unknown>;
  createdAt: string;
}

type SavedViewRow = InferSelectModel<typeof savedViews>;

function toRecord(row: SavedViewRow): SavedViewRecord {
  return {
    id: row.id,
    module: row.module,
    name: row.name,
    filters: row.filters,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Re-exported so callers (the API route) only need one import for the error type —
 * same class, not a subclass, since normalizeSavedViewInput() already throws exactly
 * this type and createSavedView() does not wrap it in anything else. */
export { SavedViewValidationError as SavedViewError } from "@/lib/savedViews/validation";
export async function listSavedViews(userId: string, module: string): Promise<SavedViewRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select()
    .from(savedViews)
    .where(
      and(
        eq(savedViews.orgId, orgId),
        eq(savedViews.userId, userId),
        eq(savedViews.module, module)
      )
    )
    .orderBy(desc(savedViews.createdAt));
  return rows.map(toRecord);
}

export async function createSavedView(input: {
  userId: string;
  module: string;
  name: string;
  filters: Record<string, unknown>;
}): Promise<SavedViewRecord> {
  const { module, name } = normalizeSavedViewInput(input);

  const orgId = await getTenantOrgId();
  const row = await insertRecord(savedViews, {
    id: generateId("VIEW"),
    orgId,
    userId: input.userId,
    module,
    name,
    filters: input.filters,
  });
  return toRecord(row);
}

/**
 * Deletes a saved view, but only if it belongs to this (org, user) — a stray id for
 * someone else's view, or another org's view, is treated as "not found" rather than a
 * raw unauthorized-but-informative error, same reasoning as src/db/repo.ts's `findById`
 * (not found and belongs-to-someone-else are the same outcome from the caller's side).
 */
export async function deleteSavedView(userId: string, id: string): Promise<boolean> {
  const orgId = await getTenantOrgId();
  const rows = await db
    .delete(savedViews)
    .where(
      and(
        eq(savedViews.orgId, orgId),
        eq(savedViews.userId, userId),
        eq(savedViews.id, id)
      )
    )
    .returning({ id: savedViews.id });
  return rows.length > 0;
}
