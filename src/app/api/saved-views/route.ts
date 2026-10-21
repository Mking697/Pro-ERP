import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/guard";
import { createSavedView, listSavedViews, SavedViewError } from "@/lib/savedViews";

/**
 * List/create for "Saved Views/Filters" (src/components/saved-views-bar.tsx). Guarded by
 * `requireSession` alone, not a specific module grant — a saved view is scoped to whatever
 * module string the caller passes, and the board that embeds SavedViewsBar already enforces
 * its own module access before a user ever sees the filters being saved; this route itself
 * holds no business data beyond a user's own filter choices.
 */
export async function GET(request: Request) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const moduleParam = new URL(request.url).searchParams.get("module")?.trim();
  if (!moduleParam) {
    return NextResponse.json({ error: "Module query param zaroori hai." }, { status: 400 });
  }

  const views = await listSavedViews(guard.session.userId, moduleParam);
  return NextResponse.json({ views });
}

const bodySchema = z.object({
  module: z.string().trim().min(1),
  name: z.string().trim().min(1).max(80),
  filters: z.record(z.string(), z.unknown()),
});

export async function POST(request: Request) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const view = await createSavedView({
      userId: guard.session.userId,
      module: parsed.data.module,
      name: parsed.data.name,
      filters: parsed.data.filters,
    });
    return NextResponse.json({ view }, { status: 201 });
  } catch (err) {
    if (err instanceof SavedViewError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
