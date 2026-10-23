import { z } from "zod";
export class CostingError extends Error { constructor(message: string, public readonly status = 400) { super(message); } }
export const decimal = z.string().regex(/^(0|[1-9]\d{0,8})(\.\d{1,6})?$/, "Use a nonnegative decimal with at most 9 integer and 6 fractional digits");
const text = z.string().min(1).max(200).refine(s => s.trim() === s && !/[\x00-\x1f\ud800-\udfff]/u.test(s), "Invalid text");
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => { const d = new Date(s + "T00:00:00Z"); return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === s; }, "Invalid calendar date");
export const inputSchema = z.object({ productSku: text, batchQty: decimal.refine(s => units(s) > BigInt(0), "Batch quantity must be positive"), asOfDate: date, charges: z.array(z.object({ head: z.enum(["Labour", "DirectExpense", "FactoryOverhead", "Commercial"]), description: text, basis: z.enum(["Batch", "PerUnit", "LabourHours", "MachineHours"]), quantity: decimal, rate: decimal }).strict()).max(100) }).strict();
export const standardSchema = z.object({ sku: text, uom: text, rate: decimal, effectiveDate: date, reason: text }).strict();
export const createSchema = z.object({ input: inputSchema, supersedesId: text.optional() }).strict();
export const versionSchema = z.object({ expectedVersion: z.number().int().min(1).max(2147483646) }).strict();
export const updateSchema = versionSchema.extend({ input: inputSchema }).strict();
export const idSchema = text;
export const SCALE = BigInt(1000000);
export function units(s: string): bigint { decimal.parse(s); const [a,b = ""] = s.split("."); return BigInt(a) * SCALE + BigInt(b.padEnd(6,"0")); }
export function quantity(n: bigint): string { if (n > BigInt("999999999999999999999999999999")) throw new CostingError("Calculated quantity exceeds supported bounds"); return (n / SCALE).toString() + (n % SCALE ? "." + (n % SCALE).toString().padStart(6,"0").replace(/0+$/,"") : ""); }
export function money(cents: bigint): string { if (cents > BigInt("999999999999999999999999999999")) throw new CostingError("Calculated money exceeds supported bounds"); return `${cents / BigInt(100)}.${(cents % BigInt(100)).toString().padStart(2,"0")}`; }
export function round(n: bigint, d: bigint): bigint { return (n + d / BigInt(2)) / d; }
