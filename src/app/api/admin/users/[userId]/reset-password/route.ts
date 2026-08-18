import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guard";
import { resetUserPassword } from "@/lib/auth/users";

const resetSchema = z.object({
  password: z.string().min(6, "Password kam se kam 6 characters ka ho."),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const { userId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = resetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    await resetUserPassword(userId, parsed.data.password);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Password reset nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
