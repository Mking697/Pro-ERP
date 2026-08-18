import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guard";
import { updateUser, toSafeUser } from "@/lib/auth/users";
import { ROLES } from "@/lib/roles";

const updateSchema = z.object({
  role: z.enum(ROLES).optional(),
  department: z.string().optional(),
  phoneNumber: z.string().optional(),
  status: z.enum(["Active", "Inactive"]).optional(),
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
