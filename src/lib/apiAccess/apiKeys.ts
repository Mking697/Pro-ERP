import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { apiKeys } from "@/db/schema";
import { db } from "@/db/client";
import { insertRecord } from "@/db/repo";
import { generateId } from "@/lib/id";

/**
 * API keys — long-lived bearer secrets an org's Admin mints for server-to-server reads
 * against `/api/v1/*` (see src/lib/auth/apiKeyGuard.ts for the auth side). Only the
 * sha256 hash of the real secret is ever persisted; the plaintext is returned exactly
 * once, from `generateApiKey()`, at creation time.
 */

const KEY_PREFIX = "pk_live_";
const SECRET_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Random secret body — same `crypto.getRandomValues` + alphabet-modulo style as
 * src/lib/id.ts's own `randomSuffix()`, just a wider (base62-ish) alphabet since this
 * value is a bearer secret, not a sheet-row ID meant to be read aloud. */
function randomSecret(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => SECRET_ALPHABET[b % SECRET_ALPHABET.length]).join("");
}

function hashKey(plaintextKey: string): string {
  return createHash("sha256").update(plaintextKey).digest("hex");
}

export interface ApiKeySummary {
  id: string;
  label: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface NewApiKey {
  id: string;
  label: string;
  /** The real bearer secret — shown exactly once, here. Never persisted in plaintext,
   * never retrievable again after this call returns. */
  plaintextKey: string;
}

/** Mints a new key for `orgId`. The returned `plaintextKey` is the ONLY time the real
 * secret is ever available — callers must show it to the Admin once and never persist it
 * client-side beyond that single response. */
export async function generateApiKey(
  orgId: string,
  label: string,
  createdBy: string
): Promise<NewApiKey> {
  const trimmedLabel = label.trim();
  if (!trimmedLabel) throw new Error("API key ka label dena zaroori hai.");

  const plaintextKey = `${KEY_PREFIX}${randomSecret(32)}`;
  const id = generateId("API");
  await insertRecord(apiKeys, {
    id,
    orgId,
    label: trimmedLabel,
    keyHash: hashKey(plaintextKey),
    keyPrefix: plaintextKey.slice(0, 8 + KEY_PREFIX.length),
    createdBy,
  });

  return { id, label: trimmedLabel, plaintextKey };
}

/** Every key this org has ever minted, active or revoked — never the hash. */
export async function listApiKeys(orgId: string): Promise<ApiKeySummary[]> {
  const rows = await db.select().from(apiKeys).where(eq(apiKeys.orgId, orgId));
  return rows
    .map((row) => ({
      id: row.id,
      label: row.label,
      keyPrefix: row.keyPrefix,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
      revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Revokes one of `orgId`'s own keys — scoped to `orgId` so one org can never revoke
 * another's key by guessing an id. The row is kept (never deleted) so its audit history
 * (lastUsedAt, createdAt) survives. No-op (returns false) if the id doesn't belong to
 * this org or is already revoked. */
export async function revokeApiKey(orgId: string, keyId: string): Promise<boolean> {
  const [row] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.orgId, orgId), eq(apiKeys.id, keyId), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });
  return Boolean(row);
}

/** Hashes `plaintextKey` and looks up an active (not revoked) key by that hash. Returns
 * the owning `orgId`, or null if the key is unknown or revoked — the revoked filter is
 * applied in the query itself, not as an app-code afterthought, so a revoked key can
 * never slip through a future refactor that forgets to re-check `revokedAt`.
 *
 * Also best-effort bumps `lastUsedAt` — a failure writing that timestamp must never fail
 * the auth check itself, so it's fire-and-forget with its own catch. */
export async function verifyApiKey(plaintextKey: string): Promise<string | null> {
  const keyHash = hashKey(plaintextKey);
  const [row] = await db
    .select({ id: apiKeys.id, orgId: apiKeys.orgId })
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!row) return null;

  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id))
    .catch(() => {
      // Best-effort only — an API key's usability must never depend on this write landing.
    });

  return row.orgId;
}
