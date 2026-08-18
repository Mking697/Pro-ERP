import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guard";
import { listUsers, createUser, toSafeUser } from "@/lib/auth/users";
import { ROLES } from "@/lib/roles";

export async function GET() {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const users = await listUsers();
  return NextResponse.json({ users: users.map(toSafeUser) });
}

const createSchema = z.object({
  fullName: z.string().min(1, "Naam zaroori hai."),
  email: z.string().email(),
  password: z.string().min(6, "Password kam se kam 6 characters ka ho."),
  role: z.enum(ROLES),
  department: z.string().optional().default(""),
  phoneNumber: z.string().optional().default(""),
});

export async function POST(request: Request) {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const user = await createUser({ ...parsed.data, createdBy: guard.session.email });
    return NextResponse.json({ user: toSafeUser(user) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "User create nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
