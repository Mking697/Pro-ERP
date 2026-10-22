/** Server-side financial bounds. Numeric Postgres columns are unbounded; JS arithmetic
 * is not. Keep paise/milli-quantity arithmetic well below Number.MAX_SAFE_INTEGER.
 * These deliberately generous business limits also reject overflow products/totals,
 * not merely their operands. Validate BEFORE rounding/coercing or clamping UI values.
 */
export const MAX_MONEY = 1_000_000_000_000;
export const MAX_QUANTITY = 1_000_000_000;
export const MAX_EXCHANGE_RATE = 1_000_000;

type DomainError = new (message: string) => Error;
export function assertFinancialNumber(
  value: number, label: string, ErrorType: DomainError,
  max = MAX_MONEY, positive = false,
): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 ||
      (positive && value <= 0) || value > max) {
    throw new ErrorType(`${label} must be finite and in range ${positive ? "(0" : "[0"}, ${max}].`);
  }
}
