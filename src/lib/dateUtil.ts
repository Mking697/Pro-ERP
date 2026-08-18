/** Formats in local time as "YYYY-MM-DDTHH:mm" — the same shape <input type="datetime-local"> uses. */
export function formatDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "YYYY-MM-DD" for a given date, in Asia/Kolkata — used to decide "today" for daily
 * recurring-task generation regardless of which UTC hour the server/cron runs in. */
export function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}
