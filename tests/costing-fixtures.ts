import type { CostFacts } from "@/lib/costing/engine";
import type { CostSheetInput } from "@/lib/costing/types";
export const input: CostSheetInput = { productSku: "FG", batchQty: "3", asOfDate: "2026-10-23", charges: [] };
export const facts: CostFacts = { product: { sku: "FG", name: "Widget", uom: "Nos" }, bom: [{ bomId: "B1", version: "1", componentSku: "RM", componentName: "Steel", qtyPerUnit: "0.1", uom: "Kg" }], items: [{ sku: "RM", name: "Steel", uom: "Kg" }], purchases: [{ id: "L1", sku: "RM", uom: "Kg", receivedQty: "1", receivedAt: "2026-10-23T18:29:59.000Z", newPrice: "0.15", oldPrice: "9", status: "Completed", indentStatus: "Received", description: "PO1 / IND1" }], standards: [] };
