import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/guard";
import { deleteOrganization, getOrganization, updateOrganization } from "@/lib/platform/registry";

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

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;

  const { orgId } = await params;

  // The organization's name has to be typed back to confirm. A registry row is one click
  // away from every other row, and this action cannot be undone from the UI — so it asks
  // for something that cannot be produced by a stray click.
  const body = await request.json().catch(() => null);
  const confirmName = typeof body?.confirmName === "string" ? body.confirmName.trim() : "";

  try {
    const org = await getOrganization(orgId);
    if (!org) {
      return NextResponse.json({ error: "Organization nahi mili." }, { status: 404 });
    }
    if (confirmName.toLowerCase() !== org.Org_Name.trim().toLowerCase()) {
      return NextResponse.json(
        { error: "Organization ka naam theek se likhein." },
        { status: 400 }
      );
    }

    // Only the tenancy ends. The organization's own Google Sheets are theirs and are
    // left untouched — this platform has no business deleting a customer's records.
    await deleteOrganization(orgId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Delete nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
