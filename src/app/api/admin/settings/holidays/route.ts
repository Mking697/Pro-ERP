import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guard";
import { listHolidays, upsertHoliday } from "@/lib/holidays";

export async function GET() {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const holidays = await listHolidays();
  return NextResponse.json({ holidays });
}

const bodySchema = z.object({
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date YYYY-MM-DD format me honi chahiye."),
  name: z.string().trim().optional().default(""),
});

export async function POST(request: Request) {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  const holiday = await upsertHoliday(parsed.data.date, parsed.data.name);
  return NextResponse.json({ holiday });
}
