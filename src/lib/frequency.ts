export const FREQUENCIES = [
  { code: "D", label: "Daily (D)" },
  { code: "W", label: "Weekly (W)" },
  { code: "15D", label: "Every 15 Days (15D)" },
  { code: "M", label: "Monthly (M)" },
  { code: "Q", label: "Quarterly (Q)" },
  { code: "Y", label: "Yearly (Y)" },
] as const;

export type FrequencyCode = (typeof FREQUENCIES)[number]["code"];

export const FREQUENCY_CODES = FREQUENCIES.map((f) => f.code) as [FrequencyCode, ...FrequencyCode[]];

export function getFrequencyLabel(code: string): string {
  return FREQUENCIES.find((f) => f.code === code)?.label ?? code;
}
