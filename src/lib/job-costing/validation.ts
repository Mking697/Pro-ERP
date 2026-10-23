import { z } from "zod";
import { date, decimal, units } from "@/lib/costing/validation";
import { translatorFor } from "@/lib/i18n";
import type { JobCostFacts, JobCostInput } from "./types";

// Stable English evidence/diagnostic metadata, independent of the viewer locale.
const t = translatorFor("en");
const text = z.string().min(1).max(500).refine(s => s.trim() === s && !/[\x00-\x1f\ud800-\udfff]/u.test(s), "Invalid text");
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/).refine(s => {
  const parsed = new Date(s);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === (s.includes(".") ? s : s.replace("Z", ".000Z"));
}, "Invalid UTC instant");
const head = z.enum(["Labour", "DirectExpense", "FactoryOverhead", "Commercial"]);
const reconciliation = z.enum(["Reconciled", "Incomplete"]);
const positive = decimal.refine(s => units(s) > BigInt(0), "Quantity must be positive");
const cents = decimal.refine(s => units(s) % BigInt(10000) === BigInt(0), "Amount must have cent precision");
const headDecision = z.object({ head, status: z.enum(["Entered", "NotApplicable"]), reason: text }).strict();
const charge = z.object({
  id: text, head, description: text, basis: z.enum(["Batch", "PerGoodUnit", "LabourHours", "MachineHours", "PerPiece"]),
  quantity: positive, rate: decimal, reason: text, evidenceRef: text,
}).strict().superRefine((value, context) => {
  const allowed = {
    Labour: ["LabourHours", "PerPiece"], DirectExpense: ["Batch"],
    FactoryOverhead: ["PerGoodUnit", "LabourHours", "MachineHours"], Commercial: ["Batch", "PerGoodUnit"],
  };
  if (!allowed[value.head].includes(value.basis)) context.addIssue({ code: "custom", path: ["basis"], message: t("Basis is incompatible with cost head") });
  if ((value.basis === "Batch" || value.basis === "PerGoodUnit") && units(value.quantity) !== BigInt(1000000)) {
    context.addIssue({ code: "custom", path: ["quantity"], message: t("Batch/per-good-unit input quantity must be 1") });
  }
});
const generalDecision = z.object({
  lineId: text, classification: z.enum(["DirectExpense", "FactoryOverhead", "Commercial", "ExcludedCapital", "ExcludedOther"]),
  allocatedAmount: cents, basis: text, reason: text,
}).strict().superRefine((value, context) => {
  if (value.classification.startsWith("Excluded") && units(value.allocatedAmount) !== BigInt(0)) {
    context.addIssue({ code: "custom", path: ["allocatedAmount"], message: t("Excluded sources must allocate zero") });
  }
});
function unique(values: string[], context: z.RefinementCtx, path: string) {
  if (new Set(values).size !== values.length) context.addIssue({ code: "custom", path: [path], message: t("Duplicate identity") });
}
export const jobCostInputSchema = z.object({
  planId: text, asOfDate: date, headDecisions: z.array(headDecision).max(4), charges: z.array(charge).max(100),
  generalDecisions: z.array(generalDecision).max(1000),
}).strict().superRefine((value, context) => {
  unique(value.headDecisions.map(d => d.head), context, "headDecisions");
  unique(value.charges.map(c => c.id), context, "charges");
  unique(value.charges.map(c => c.evidenceRef), context, "charges");
  unique(value.generalDecisions.map(d => d.lineId), context, "generalDecisions");
});
const issue = z.object({ id: text, timestamp: instant, quantity: decimal, userId: text }).strict();
const valuation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("Missing") }).strict(),
  z.object({ kind: z.literal("PurchaseAgreedProvisional"), rate: decimal, uom: text, currency: z.literal("INR"), date: instant,
    poId: text, lineId: text, indentId: text, receiptId: text }).strict(),
  z.object({ kind: z.literal("ApprovedStandardProvisional"), rate: decimal, uom: text, currency: z.literal("INR"), date,
    standardId: text, approvedBy: text, approvedAt: instant, reason: text }).strict(),
]);
const diagnostic = z.object({ code: text, blocking: z.boolean(), sourceIds: z.array(text), message: text }).strict();
export const jobCostFactsSchema = z.object({
  orgId: text, capturedAt: instant, capturedBy: text, sourceFingerprint: text,
  plan: z.object({ planId: text, jobNo: text, productSku: text, productName: text, productUom: text, bomId: text,
    bomVersion: text, status: z.enum(["Ready", "Shortage", "In_Production", "Completed", "Cancelled"]), startedAt: instant.nullable() }).strict(),
  materials: z.array(z.object({ sku: text, name: text, uom: text, requiredQty: decimal.nullable(), consumedQty: decimal.nullable(),
    reconciliation, issues: z.array(issue), valuation }).strict()),
  output: z.object({ reconciliation, runIds: z.array(text), events: z.array(issue.extend({ sku: text, uom: text, referenceId: text, source: text, direction: z.enum(["In", "Out"]) }).strict()) }).strict(),
  generalSources: z.array(z.object({ poId: text, lineId: text, planId: text, status: z.enum(["Open", "Completed", "Cancelled"]),
    orderedQty: decimal, receivedQty: decimal.nullable(), receivedAt: instant.nullable(), receivedBy: text.nullable(),
    uom: text, rate: decimal, orderedAmount: cents, activeAllocatedAmount: cents, sourceFingerprint: text,
    reconciliation, evidenceRefs: z.array(text) }).strict()),
  diagnostics: z.array(diagnostic),
}).strict().superRefine((value, context) => {
  unique(value.materials.map(m => m.sku), context, "materials");
  unique([...value.materials.flatMap(m => m.issues.map(i => i.id)), ...value.output.events.map(e => e.id)], context, "materials");
  unique(value.output.runIds, context, "output");
  unique(value.generalSources.map(g => g.lineId), context, "generalSources");
});

/** Browser boundary: no source values, totals, tenant or approval identity accepted. */
export function parseJobCostInput(value: unknown): JobCostInput { return jobCostInputSchema.parse(value); }
/** Server boundary only. Adapter must prove tenant/joins/provenance; this validates normalized shape, not SQL ownership. */
export function normalizeJobCostFacts(value: unknown): JobCostFacts { return jobCostFactsSchema.parse(value); }
export function jobCutoffInstant(value: string): string {
  return new Date(date.parse(value) + "T23:59:59.999+05:30").toISOString();
}
