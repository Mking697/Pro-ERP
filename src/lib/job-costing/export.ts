/**
 * J5 — saved-snapshot export for Recorded Job Cost Sheets. Reads only a persisted
 * `JobCostSheet`'s own `calculation` (never unsaved preview state), mirroring
 * `src/lib/costing/export.ts`'s one-saved-DTO convention, extended here with explicit
 * formula-injection defusing for BOTH xlsx and csv (the estimated feature's `export.ts`
 * does not escape leading `=`/`+`/`-`/`@`; this module intentionally does, reusing
 * `src/lib/csv.ts`'s `csvCell` escaping rule for every text cell in both formats).
 */
import ExcelJS from "exceljs";
import { buildCsv } from "@/lib/csv";
import type { JobCostSheet } from "./types";

type Cell = string | number | null | undefined;

/** Same rule as `csvCell`: a leading formula-trigger character gets a defusing leading
 * apostrophe so Excel/Sheets treat the cell as text, never a formula, on first open. */
function safeText(value: Cell): string {
  if (value === null || value === undefined) return "Unavailable";
  let s = String(value);
  if ([61, 43, 45, 64, 9, 13, 10, 0xff1d, 0xff0b, 0xff0d, 0xff20].includes(s.charCodeAt(0))) s = `'${s}`;
  return s;
}

function safeFilename(id: string, revision: number, ext: "xlsx" | "csv"): string {
  return `job-cost-sheet-${id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80)}-r${revision}.${ext}`;
}

function rows(sheet: JobCostSheet): Cell[][] {
  const c = sheet.calculation;
  const out: Cell[][] = [];
  out.push(["Recorded Job Cost Sheet — provisional management valuation, not proven actual cost or GL posting"]);
  out.push(["Sheet ID", sheet.id, "Revision", sheet.revision, "Status", sheet.status, "Version", sheet.version]);
  out.push(["Plan ID", c.plan.planId, "Job No", c.plan.jobNo, "Product", `${c.plan.productName} (${c.plan.productSku})`]);
  out.push(["Plan status", c.plan.status, "Started at", c.plan.startedAt]);
  out.push(["As of (IST)", c.input.asOfDate, "Captured at", c.capturedAt, "Captured by", c.capturedBy]);
  out.push(["Source fingerprint", c.sourceFingerprint]);
  out.push(["Source complete", String(c.sourceComplete), "Valuation complete", String(c.valuationComplete), "Can finalize", String(c.canFinalize), "Valuation status", c.valuationStatus]);
  out.push(["Created by", sheet.createdBy, "Created at", sheet.createdAt, "Updated at", sheet.updatedAt]);
  out.push(["Finalized by", sheet.finalizedBy, "Finalized at", sheet.finalizedAt, "Supersedes", sheet.supersedesId]);
  out.push([]);
  out.push(["Output basis", c.output.basis, "Quantity", c.output.quantity, "UOM", c.output.uom, "Timestamp", c.output.timestamp]);
  out.push(["Output caveat", c.output.caveat]);
  out.push([]);
  out.push(["Material SKU", "Name", "UOM", "Required qty", "Consumed qty", "Issued qty", "Reconciliation", "Valuation kind", "Rate", "Amount"]);
  for (const m of c.materials) {
    out.push([m.sku, m.name, m.uom, m.requiredQty, m.consumedQty, m.issuedQuantity, m.reconciliation, m.valuation.kind, "rate" in m.valuation ? m.valuation.rate : null, m.amount]);
  }
  out.push([]);
  out.push(["General PO line", "PO", "Status", "Ordered qty", "Received qty", "Rate", "Ordered amount", "Eligibility", "Eligible cap", "Classification", "Allocated amount"]);
  for (const g of c.generalSources) {
    out.push([g.lineId, g.poId, g.status, g.orderedQty, g.receivedQty, g.rate, g.orderedAmount, g.eligibility, g.eligibleCap, g.decision?.classification ?? null, g.allocatedAmount]);
  }
  out.push([]);
  out.push(["Cost head", "Description", "Basis", "Applied quantity", "Rate", "Amount", "Evidence ref", "Approved by", "Approved at"]);
  for (const charge of c.charges) {
    out.push([charge.head, charge.description, charge.basis, charge.appliedQuantity, charge.rate, charge.amount, charge.evidenceRef, charge.approvedBy, charge.approvedAt]);
  }
  out.push([]);
  for (const [name, value] of Object.entries(c.totals)) out.push([name, value]);
  out.push([]);
  for (const limitation of c.limitations) out.push(["Limitation", limitation]);
  for (const diagnostic of c.diagnostics) out.push(["Diagnostic", diagnostic.code, diagnostic.blocking ? "blocking" : "informational", diagnostic.message]);
  return out;
}

/** All cells become literal strings/numbers; untrusted source/evidence text can never
 * become an ExcelJS formula object, and every text cell is additionally defused (safeText)
 * against a leading `=`/`+`/`-`/`@` interpreted as a formula on open. */
export async function exportJobCostSheetXlsx(sheet: JobCostSheet): Promise<{ buffer: ExcelJS.Buffer; filename: string }> {
  const book = new ExcelJS.Workbook();
  const page = book.addWorksheet("Recorded Job Cost");
  for (const row of rows(sheet)) page.addRow(row.map((value) => (typeof value === "number" ? value : safeText(value))));
  page.views = [{ state: "frozen", ySplit: 9 }];
  page.columns.forEach((column) => { column.width = 24; });
  page.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true }; });
  return { buffer: await book.xlsx.writeBuffer(), filename: safeFilename(sheet.id, sheet.revision, "xlsx") };
}

/** `buildCsv`/`csvCell` (src/lib/csv.ts) already defuse formula-leading characters and
 * quote-escape every cell; reused as-is rather than reimplemented. */
export function exportJobCostSheetCsv(sheet: JobCostSheet): { csv: string; filename: string } {
  const csv = buildCsv(rows(sheet).map((row) => row.map((value) => (value === null || value === undefined ? "Unavailable" : value))));
  return { csv, filename: safeFilename(sheet.id, sheet.revision, "csv") };
}
