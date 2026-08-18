import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { listUsers } from "@/lib/auth/users";

/** Minimal, low-sensitivity user list (no email/phone) — any logged-in user can read this
 * to resolve names for task assignment and attribution. */
export async function GET() {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const users = await listUsers();
  const directory = users
    .filter((u) => u.Status === "Active")
    .map((u) => ({
      userId: u.User_ID,
      fullName: u.Full_Name,
      role: u.Role,
      department: u.Department,
    }));

  return NextResponse.json({ users: directory });
}
