/** Short, collision-safe ID for new sheet rows — no need to read the sheet first to count rows. */
export function generateId(prefix: string): string {
  const time = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${time}${rand}`;
}
