import { translatorFor } from "@/lib/i18n";
// Provenance snapshots use stable English labels, independent of the viewer locale.
const t = translatorFor("en");
import type { CostCalculation, CostRateSource, CostSheetInput, StandardCostRate } from "./types";
import { CostingError, inputSchema, money, quantity, round, SCALE, units } from "./validation";
export interface CostFacts {
 product: { sku: string; name: string; uom: string };
 bom: { bomId: string; version: string; componentSku: string; componentName: string; qtyPerUnit: string | null; uom: string }[];
 items: { sku: string; name: string; uom: string }[];
 purchases: { id: string; sku: string; uom: string; receivedQty: string | null; receivedAt: string | null; newPrice: string | null; oldPrice: string | null; status: string; indentStatus: string; description: string }[];
 sourceWarnings?: string[];
 standards: StandardCostRate[];
}
const valid = (s: string | null): s is string => { try { if (s === null) return false; units(s); return true; } catch { return false; } };
export function calculateCostSheet(raw: CostSheetInput, facts: CostFacts): CostCalculation {
 const input = inputSchema.parse(raw), batch = units(input.batchQty), warnings: string[] = ["Estimated product cost; not recorded actual cost. INR; recoverable taxes excluded. Stock SKU leaves are not recursively exploded.", ...facts.sourceWarnings ?? []];
 if (facts.product.sku !== input.productSku || !facts.product.uom) throw new CostingError("Product master or product UOM is missing");
 if (!facts.bom.length || new Set(facts.bom.map(b => b.bomId + "\u0000" + b.version)).size !== 1) throw new CostingError("Exactly one active BOM/version is required for this product SKU");
 const seen = new Set<string>(); let known = BigInt(0), complete = true;
 const cutoff = new Date(input.asOfDate + "T23:59:59.999+05:30").getTime();
 const materials = facts.bom.map(b => {
  if (!b.componentSku || seen.has(b.componentSku)) throw new CostingError("BOM contains duplicate or empty component SKU"); seen.add(b.componentSku);
  if (!valid(b.qtyPerUnit) || units(b.qtyPerUnit) === BigInt(0)) throw new CostingError(`Invalid BOM quantity for ${b.componentSku}`);
  const q = units(b.qtyPerUnit), required = q * batch;
  const rawQty = required.toString().padStart(13,"0"), requiredQty = (rawQty.slice(0,-12) + "." + rawQty.slice(-12)).replace(/\.?0+$/, "") || "0";
  const master = facts.items.find(i => i.sku === b.componentSku);
  let rate: string | null = null; let source: CostRateSource = { kind: "Missing", id: "", date: "", description: t("No eligible received purchase or approved standard rate") };
  if (master && b.uom && master.uom === b.uom) {
   const candidates = facts.purchases.filter(p => p.sku === b.componentSku && p.uom === b.uom && ["Open", "Completed"].includes(p.status) && ["Received", "Partially_Received"].includes(p.indentStatus) && valid(p.receivedQty) && units(p.receivedQty) > BigInt(0) && p.receivedAt && Number.isFinite(Date.parse(p.receivedAt)) && Date.parse(p.receivedAt) <= cutoff).sort((a,b) => Date.parse(b.receivedAt!) - Date.parse(a.receivedAt!) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
   const p = candidates[0];
   if (p) { const r = p.newPrice ?? p.oldPrice; if (valid(r)) { rate = r; source = { kind: "Purchase", id: p.id, date: p.receivedAt!, description: p.description }; } else warnings.push(`Latest eligible purchase ${p.id} has no valid agreed INR rate`); }
   if (rate === null) { const s = facts.standards.filter(s => s.sku === b.componentSku && s.uom === b.uom && s.effectiveDate <= input.asOfDate && valid(s.rate)).sort((a,b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.approvedAt.localeCompare(a.approvedAt) || b.id.localeCompare(a.id))[0]; if (s) { rate = s.rate; source = { kind: "Standard", id: s.id, date: s.effectiveDate, description: t("Approved by") + ` ${s.approvedBy}: ${s.reason}` }; } }
  } else source.description = master ? "BOM UOM differs from current item master UOM" : "Component item master missing";
  let amount: string | null = null;
  if (rate === null) { complete = false; warnings.push(`${b.componentSku}: ${source.description}`); }
  else { const cents = round(required * units(rate) * BigInt(100), SCALE * SCALE * SCALE); known += cents; amount = money(cents); }
  return { sku: b.componentSku, name: master?.name ?? b.componentName, uom: b.uom, qtyPerUnit: b.qtyPerUnit, requiredQty, rate, amount, source };
 });
 const sums = { Labour: BigInt(0), DirectExpense: BigInt(0), FactoryOverhead: BigInt(0), Commercial: BigInt(0) };
 const charges = input.charges.map(c => { const q = c.basis === "Batch" ? SCALE : c.basis === "PerUnit" ? batch : units(c.quantity); const cents = round(q * units(c.rate) * BigInt(100), SCALE * SCALE); sums[c.head] += cents; return { ...c, appliedQuantity: quantity(q), amount: money(cents) }; });
 const manufacturing = known + sums.Labour + sums.DirectExpense + sums.FactoryOverhead, full = manufacturing + sums.Commercial;
 return { productSku: input.productSku, productName: facts.product.name, productUom: facts.product.uom, bomId: facts.bom[0].bomId, bomVersion: facts.bom[0].version, input, materials, charges, complete, warnings, totals: { knownMaterialSubtotal: money(known), material: complete ? money(known) : null, labour: money(sums.Labour), directExpenses: money(sums.DirectExpense), factoryOverhead: money(sums.FactoryOverhead), manufacturing: complete ? money(manufacturing) : null, commercial: money(sums.Commercial), fullCost: complete ? money(full) : null, perUnit: complete ? money(round(full * SCALE, batch)) : null } };
}
