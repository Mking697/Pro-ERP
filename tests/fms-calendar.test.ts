import { describe, expect, it } from "vitest";
import {
  addWorkingMinutes,
  type CalendarOverrides,
  type DayWindow,
  type WeekSchedule,
} from "@/lib/fms/workingCalendar";
import { computeTatDeadline } from "@/lib/fms/calendar";
import { createUser } from "@/lib/auth/users";
import { runWithTenant } from "@/lib/tenant";
import { upsertSetting } from "@/lib/settings";
import { deleteOrganization, getOrganization } from "@/lib/platform/registry";
import { todayIST } from "@/lib/dateUtil";
import { makeTestOrg } from "./helpers/testOrg";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/** Builds the epoch instant for an IST wall-clock reading — the exact inverse of how
 * workingCalendar.ts's own toIst()/fromIst() read an epoch back as IST wall-clock fields. */
function istWallClock(y: number, mo: number, d: number, hh: number, mm: number): number {
  return Date.UTC(y, mo - 1, d, hh, mm) - IST_OFFSET_MS;
}

const noOverrides: CalendarOverrides = {
  holidayDates: new Set(),
  workingOverrideDates: new Set(),
  overrideWindows: [],
};

describe("workingCalendar (pure)", () => {
  it("a 30-minute TAT starting just before lunch lands 30 working minutes later, not 30 wall-clock minutes later", () => {
    // 09:00-13:00 and 13:30-18:00 every day — lunch already excluded from the windows,
    // exactly as calendar.ts's buildShiftWindows() hands this module its schedule.
    const dayWindows: DayWindow[] = [
      { startMin: 9 * 60, endMin: 13 * 60 },
      { startMin: 13 * 60 + 30, endMin: 18 * 60 },
    ];
    const schedule: WeekSchedule = { windowsByWeekday: Array(7).fill(dayWindows) };

    const start = istWallClock(2027, 3, 10, 12, 50); // 10 minutes before lunch
    const deadline = addWorkingMinutes(start, 30, schedule, noOverrides);

    expect(deadline).toBe(istWallClock(2027, 3, 10, 13, 50));
  });

  it("skips a weekly-off day entirely rather than counting it as elapsed time", () => {
    const fullDay: DayWindow[] = [{ startMin: 9 * 60, endMin: 18 * 60 }];
    const baseWeekday = new Date(Date.UTC(2027, 2, 10)).getUTCDay(); // arbitrary anchor date
    const offWeekday = (baseWeekday + 1) % 7; // the very next calendar day is the weekly-off

    const windowsByWeekday: DayWindow[][] = Array.from({ length: 7 }, (_, wd) =>
      wd === offWeekday ? [] : fullDay
    );
    const schedule: WeekSchedule = { windowsByWeekday };

    const start = istWallClock(2027, 3, 10, 17, 50); // 10 minutes before closing
    const deadline = addWorkingMinutes(start, 30, schedule, noOverrides);

    // 10 minutes consumed to close out day 0; day 1 (offWeekday) contributes nothing at
    // all; the remaining 20 minutes are consumed from day 2's own 09:00 open.
    const day2UtcMidnight = Date.UTC(2027, 2, 10) + 2 * DAY_MS;
    const expected = day2UtcMidnight + (9 * 60 + 20) * 60_000 - IST_OFFSET_MS;

    expect(deadline).toBe(expected);
  });

  it("skips an explicit holiday date the same way, on an otherwise fully working week", () => {
    const fullDay: DayWindow[] = [{ startMin: 9 * 60, endMin: 18 * 60 }];
    const schedule: WeekSchedule = { windowsByWeekday: Array(7).fill(fullDay) };

    const day0UtcMidnight = Date.UTC(2027, 5, 1);
    const day1 = new Date(day0UtcMidnight + DAY_MS);
    const day1Key = `${day1.getUTCFullYear()}-${String(day1.getUTCMonth() + 1).padStart(2, "0")}-${String(day1.getUTCDate()).padStart(2, "0")}`;
    const overrides: CalendarOverrides = {
      holidayDates: new Set([day1Key]),
      workingOverrideDates: new Set(),
      overrideWindows: [],
    };

    const start = istWallClock(2027, 6, 1, 17, 50);
    const deadline = addWorkingMinutes(start, 30, schedule, overrides);

    const day2UtcMidnight = day0UtcMidnight + 2 * DAY_MS;
    const expected = day2UtcMidnight + (9 * 60 + 20) * 60_000 - IST_OFFSET_MS;

    expect(deadline).toBe(expected);
  });
});

/**
 * The DB-backed wrapper (src/lib/fms/calendar.ts) that FMS steps actually call — this
 * exercises the real settings read (default shift: 09:00-18:00, lunch 13:00-13:30) against
 * a throwaway org's live Postgres-stored settings, the same "30 min before lunch -> 30
 * working minutes later" check a live subagent run verified by hand against real data.
 */
describe("computeTatDeadline (live settings)", () => {
  it("excludes the default lunch break for a real user against real Postgres settings", async () => {
    const org = await makeTestOrg("Calendar");
    try {
      const deadline = await runWithTenant({ orgId: org.id, org }, async () => {
        const user = await createUser({
          fullName: "Calendar Doer",
          email: `calendar-doer-${org.id}@example.com`,
          password: "Password123!",
          role: "Staff",
          department: "Ops",
          phoneNumber: "9990000006",
          createdBy: "SYSTEM",
        });

        const today = todayIST();
        const [y, mo, d] = today.split("-").map(Number);
        // Guaranteed never to equal today's own weekday, so today is a working day no
        // matter which real calendar date this test happens to run on.
        const todayWeekday = new Date(`${today}T00:00:00Z`).getUTCDay();
        await upsertSetting("FMS_WEEKLY_OFF_DAYS", String((todayWeekday + 3) % 7));

        const start = istWallClock(y, mo, d, 12, 50);
        return computeTatDeadline(user.User_ID, start, 30, "Minutes");
      });

      const today = todayIST();
      const [y, mo, d] = today.split("-").map(Number);
      expect(deadline).toBe(istWallClock(y, mo, d, 13, 50));
    } finally {
      if (await getOrganization(org.id)) {
        await deleteOrganization(org.id).catch(() => {});
      }
    }
  });
});
