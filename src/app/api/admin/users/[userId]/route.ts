import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guard";
import { deleteUser, updateUser, toSafeUser, UserDeletionError } from "@/lib/auth/users";
import { ROLES } from "@/lib/roles";
import { MODULE_ACCESS_KEYS } from "@/lib/moduleAccess";

const updateSchema = z.object({
  role: z.enum(ROLES).optional(),
  department: z.string().optional(),
  phoneNumber: z.string().optional(),
  status: z.enum(["Active", "Inactive"]).optional(),
  moduleAccess: z.array(z.enum(MODULE_ACCESS_KEYS)).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const { userId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const user = await updateUser(userId, parsed.data);
    return NextResponse.json({ user: toSafeUser(user) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "User update nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const { userId } = await params;

  try {
    // The acting user is passed in so the library can refuse self-deletion — an Admin
    // removing their own account would be locked out mid-request.
    await deleteUser(userId, guard.session.userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UserDeletionError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "User delete nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
