import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guard";
import { getSetting, upsertSetting } from "@/lib/settings";

const MAX_SHIFTS = 4;

interface ShiftSettings {
  start: string;
  end: string;
  lunchStart: string;
  lunchEnd: string;
  teaStart: string;
  teaEnd: string;
}

export async function GET() {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const shiftCountRaw = await getSetting("FMS_SHIFT_COUNT");
  const shiftCount = Math.min(Math.max(Number(shiftCountRaw) || 1, 1), MAX_SHIFTS);

  const shifts: ShiftSettings[] = [];
  for (let i = 1; i <= shiftCount; i++) {
    const prefix = `FMS_SHIFT_${i}`;
    const [start, end, lunchStart, lunchEnd, teaStart, teaEnd] = await Promise.all([
      getSetting(`${prefix}_START`),
      getSetting(`${prefix}_END`),
      getSetting(`${prefix}_LUNCH_START`),
      getSetting(`${prefix}_LUNCH_END`),
      getSetting(`${prefix}_TEA_START`),
      getSetting(`${prefix}_TEA_END`),
    ]);
    shifts.push({
      start: start ?? "09:00",
      end: end ?? "18:00",
      lunchStart: lunchStart ?? "13:00",
      lunchEnd: lunchEnd ?? "13:30",
      teaStart: teaStart ?? "",
      teaEnd: teaEnd ?? "",
    });
  }

  const weeklyOffRaw = await getSetting("FMS_WEEKLY_OFF_DAYS");
  const weeklyOffDays = (weeklyOffRaw ?? "0")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);

  return NextResponse.json({ shiftCount, shifts, weeklyOffDays: weeklyOffDays.length ? weeklyOffDays : [0] });
}

const timeField = z
  .string()
  .trim()
  .refine((v) => v === "" || /^\d{1,2}:\d{2}$/.test(v), "HH:MM format me honi chahiye.");

const shiftSchema = z.object({
  start: timeField,
  end: timeField,
  lunchStart: timeField,
  lunchEnd: timeField,
  teaStart: timeField,
  teaEnd: timeField,
});

const bodySchema = z.object({
  shifts: z.array(shiftSchema).min(1).max(MAX_SHIFTS),
  weeklyOffDays: z.array(z.number().int().min(0).max(6)),
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

  const writes: Promise<void>[] = [upsertSetting("FMS_SHIFT_COUNT", String(parsed.data.shifts.length))];
  parsed.data.shifts.forEach((shift, i) => {
    const prefix = `FMS_SHIFT_${i + 1}`;
    writes.push(
      upsertSetting(`${prefix}_START`, shift.start),
      upsertSetting(`${prefix}_END`, shift.end),
      upsertSetting(`${prefix}_LUNCH_START`, shift.lunchStart),
      upsertSetting(`${prefix}_LUNCH_END`, shift.lunchEnd),
      upsertSetting(`${prefix}_TEA_START`, shift.teaStart),
      upsertSetting(`${prefix}_TEA_END`, shift.teaEnd)
    );
  });
  writes.push(
    upsertSetting(
      "FMS_WEEKLY_OFF_DAYS",
      (parsed.data.weeklyOffDays.length ? parsed.data.weeklyOffDays : [0]).join(",")
    )
  );

  await Promise.all(writes);
  return NextResponse.json({ success: true });
}
