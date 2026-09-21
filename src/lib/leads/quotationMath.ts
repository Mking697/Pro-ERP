/**
 * Quantity/rate/amount arithmetic for the quotation grid, and the freight/GST totals
 * calculation.
 *
 * Adapted from a reference CRM's own quotation-math.ts — same hand-written
 * recursive-descent formula parser (deliberately not eval()/new Function(), since the
 * typed expression reaches the server: the grammar itself is the whitelist — digits,
 * `. + - * / ( )` and nothing else can even be expressed) and the same "GST on goods plus
 * freight" totals rule. Ported to plain decimal numbers rather than that reference's
 * integer-paise/milli-qty scheme, to match this codebase's own money convention
 * everywhere else (a `numeric` Postgres column, read back as a string by Drizzle,
 * Number()/String() at the boundary — see src/lib/purchase/orders.ts,
 * vendor_items.unitPrice) instead of introducing a new integer-scaled convention just for
 * this one module.
 */

export class FormulaError extends Error {}

const MAX_QTY = 1_000_000_000;

/** Rounds to 2 decimal places — every rupee amount this module produces goes through
 * this once, on the way out, so nothing downstream re-derives a slightly different value
 * from floating-point drift. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Rounds a quantity to 3 decimal places — the grid's own display precision. */
export function round3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

/**
 * Evaluates an arithmetic expression typed into the quantity calculator, e.g.
 * "2.5*3+1.2". A hand-written recursive-descent parser rather than eval/new Function —
 * those would execute anything the string contained, and this string reaches the server.
 * The grammar is the whitelist: digits, `. + - * / ( )` and nothing else can even be
 * expressed.
 */
export function evaluateFormula(input: string): number {
  const text = input.replace(/[x×]/gi, "*").replace(/[÷]/g, "/").replace(/,/g, "");

  let position = 0;

  const skipSpace = () => {
    while (position < text.length && /\s/.test(text[position]!)) position += 1;
  };

  const parseNumber = (): number => {
    skipSpace();
    const start = position;
    while (position < text.length && /[\d.]/.test(text[position]!)) position += 1;
    const slice = text.slice(start, position);
    if (slice.length === 0 || !/^\d*\.?\d+$|^\d+\.$/.test(slice)) {
      throw new FormulaError(`Samajh nahi aaya: "${text[position] ?? "end"}"`);
    }
    return Number.parseFloat(slice);
  };

  const parseFactor = (): number => {
    skipSpace();
    if (text[position] === "(") {
      position += 1;
      const value = parseExpression();
      skipSpace();
      if (text[position] !== ")") throw new FormulaError("Closing bracket missing hai.");
      position += 1;
      return value;
    }
    if (text[position] === "-") {
      position += 1;
      return -parseFactor();
    }
    if (text[position] === "+") {
      position += 1;
      return parseFactor();
    }
    return parseNumber();
  };

  const parseTerm = (): number => {
    let value = parseFactor();
    for (;;) {
      skipSpace();
      const operator = text[position];
      if (operator !== "*" && operator !== "/") return value;
      position += 1;
      const right = parseFactor();
      if (operator === "/") {
        if (right === 0) throw new FormulaError("Zero se divide nahi ho sakta.");
        value /= right;
      } else {
        value *= right;
      }
    }
  };

  function parseExpression(): number {
    let value = parseTerm();
    for (;;) {
      skipSpace();
      const operator = text[position];
      if (operator !== "+" && operator !== "-") return value;
      position += 1;
      const right = parseTerm();
      value = operator === "+" ? value + right : value - right;
    }
  }

  if (text.trim().length === 0) return 0;

  const result = parseExpression();
  skipSpace();
  if (position < text.length) {
    throw new FormulaError(`Samajh nahi aaya: "${text.slice(position, position + 8)}"`);
  }
  if (!Number.isFinite(result)) throw new FormulaError("Ye number nahi ban raha.");
  if (result < 0) throw new FormulaError("Quantity negative nahi ho sakti.");
  if (result > MAX_QTY) throw new FormulaError("Ye quantity bahut badi hai.");

  return round3(result);
}

/** True when the text looks like a calculation rather than a plain number typed in. */
export function looksLikeFormula(input: string): boolean {
  return /[+\-*/()x×÷]/i.test(input.trim().replace(/^-/, ""));
}

/** The one place a line's amount is computed — qty * rate, rounded once. Nothing
 * downstream re-derives it. */
export function lineAmount(qty: number, rate: number): number {
  return round2(Math.max(0, qty) * Math.max(0, rate));
}

export interface QuotationTotals {
  subTotal: number;
  freight: number;
  gstPercent: number;
  /** What the GST percentage is charged on — subTotal + freight. Shown in the UI next to
   * the percentage so this is never a hidden assumption. */
  gstBase: number;
  gst: number;
  payable: number;
}

/**
 * GST is charged on goods PLUS freight — the composite-supply treatment: when the seller
 * arranges transport, the freight carries the same rate as the goods.
 */
export function computeTotals(
  lines: { amount: number }[],
  freight: number,
  gstPercent: number
): QuotationTotals {
  const subTotal = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  const f = round2(Math.max(0, freight));
  const percent = Math.max(0, Math.min(100, gstPercent));
  const gstBase = round2(subTotal + f);
  const gst = round2((gstBase * percent) / 100);
  return { subTotal, freight: f, gstPercent: percent, gstBase, gst, payable: round2(gstBase + gst) };
}
