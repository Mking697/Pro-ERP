import ExcelJS from "exceljs";
import type { CostSheet } from "./types";

/** All cells are literal strings. Decimal strings retain exact server precision and
 * untrusted product/source text can never become an ExcelJS formula object. */
export async function exportCostSheet(sheet: CostSheet) {
  const book = new ExcelJS.Workbook();
  const page = book.addWorksheet("Estimated Product Cost");
  const c = sheet.calculation;
  const add = (values: Array<string | number | null | undefined>) => page.addRow(values.map(value => value == null ? "Unavailable" : String(value)));
  add(["Estimated product cost — not recorded actual cost", "INR; recoverable taxes excluded"]);
  add(["Snapshot ID", sheet.id, "Revision", sheet.revision, "Status", sheet.status]);
  add(["Product SKU", sheet.productSku, "Product", sheet.productName]);
  add(["BOM", c.bomId, "BOM version", c.bomVersion]);
  add(["As of", c.input.asOfDate, "Batch quantity", c.input.batchQty, "Product UOM", c.productUom]);
  add(["Created by", sheet.createdBy, "Created at", sheet.createdAt]);
  add(["Finalized by", sheet.finalizedBy, "Finalized at", sheet.finalizedAt]);
  add([]);
  add(["SKU", "Component", "UOM", "Qty/unit", "Required qty", "Rate INR", "Amount INR", "Rate source", "Source ID", "Source date", "Source basis"]);
  for (const material of c.materials) add([material.sku, material.name, material.uom, material.qtyPerUnit, material.requiredQty, material.rate, material.amount, material.source.kind, material.source.id, material.source.date, material.source.description]);
  add([]);
  add(["Cost head", "Description", "Basis", "Applied quantity", "Rate INR", "Amount INR"]);
  for (const charge of c.charges) add([charge.head, charge.description, charge.basis, charge.appliedQuantity, charge.rate, charge.amount]);
  add([]);
  for (const [name, value] of Object.entries(c.totals)) add([name, value]);
  add(["Complete", String(c.complete)]);
  for (const warning of c.warnings) add(["Basis / warning", warning]);
  page.views = [{ state: "frozen", ySplit: 9 }];
  page.columns.forEach((column, index) => { column.width = index === 1 || index === 10 ? 42 : 22; });
  page.eachRow(row => { row.alignment = { vertical: "top", wrapText: true }; });
  return book.xlsx.writeBuffer();
}
