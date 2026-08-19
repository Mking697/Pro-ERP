import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/guard";
import { updateOrganization } from "@/lib/platform/registry";

const patchSchema = z.object({
  status: z.enum(["Active", "Suspended"]).optional(),
  plan: z.string().trim().min(1).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;

  const { orgId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  }

  try {
    // Suspending takes effect on the next request: tenantFromOrgId refuses a non-Active
    // organization, so its users are locked out without touching their data.
    const org = await updateOrganization(orgId, {
      ...(parsed.data.status ? { Status: parsed.data.status } : {}),
      ...(parsed.data.plan ? { Plan: parsed.data.plan } : {}),
    });
    return NextResponse.json({ organization: org });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
