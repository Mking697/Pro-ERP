import { z } from "zod";
import { inputSchema } from "./validation";
import type { CostSheet } from "./types";

// Validate transport structure, not browser-calculated money. The server remains
// authoritative; malformed later versions must never resolve an unknown write.
const value = z.string().regex(/^(0|[1-9]\d*)(\.\d+)?$/);
const text = z.string().min(1);
const stamp = z.string().refine(s => Number.isFinite(Date.parse(s)));
const total = value.nullable();
const calculation = z.object({
  productSku: text, productName: text, productUom: text, bomId: text, bomVersion: text,
  input: inputSchema, complete: z.boolean(), warnings: z.array(z.string()),
  materials: z.array(z.object({ sku: text, name: text, uom: z.string(), qtyPerUnit: value, requiredQty: value, rate: total, amount: total,
    source: z.object({ kind: z.enum(["Purchase", "Standard", "Missing"]), id: z.string(), date: z.string(), description: z.string() }) })),
  charges: z.array(inputSchema.shape.charges.element.extend({ appliedQuantity: value, amount: value })),
  totals: z.object({ knownMaterialSubtotal: value, material: total, labour: value, directExpenses: value, factoryOverhead: value, manufacturing: total, commercial: value, fullCost: total, perUnit: total }),
}).refine(c => c.productSku === c.input.productSku && (!c.complete || (c.materials.every(m => m.rate !== null && m.amount !== null && m.source.kind !== "Missing") && c.totals.material !== null && c.totals.manufacturing !== null && c.totals.fullCost !== null && c.totals.perUnit !== null)));
const snapshot = z.object({
  id: text, productSku: text, productName: text, revision: z.number().int().positive(), version: z.number().int().positive(), status: z.enum(["Draft", "Finalized"]), calculation,
  supersedesId: text.nullable(), createdAt: stamp, createdBy: text, updatedAt: stamp, finalizedAt: stamp.nullable(), finalizedBy: text.nullable(),
}).refine(s => s.productSku === s.calculation.productSku && (s.status === "Draft" ? s.finalizedAt === null && s.finalizedBy === null : s.calculation.complete && s.finalizedAt !== null && s.finalizedBy !== null));
export function validCostSnapshot(value: unknown): value is CostSheet { return snapshot.safeParse(value).success; }
export function sameCostIdentity(a: CostSheet, b: CostSheet): boolean {
  return a.id === b.id && a.productSku === b.productSku && a.revision === b.revision && a.supersedesId === b.supersedesId && a.createdAt === b.createdAt && a.createdBy === b.createdBy;
}
