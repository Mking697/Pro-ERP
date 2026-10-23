import {
  readPerf04ReportRows,
  readPerf04TaskInputs,
  readPerf04Payroll,
  listRecurringRows,
  listBomRows,
} from "@/lib/perf04-report-queries";
import { getInventorySnapshot } from "@/lib/inventory/service";
import type { DateRange } from "@/lib/analytics";
import type { ReportScope, ReportViewer } from "@/lib/reports";

/**
 * One place that turns a report id into the exact detail rows its screen table and its
 * export (Excel/CSV) both show — so the two can never drift (a column added to the table
 * but not the export, or vice versa). Every report here reuses the SAME query functions
 * Analytics.tsx already calls for its charts; this file adds no new data source, only a
 * row-level projection of what's already fetched there.
 *
 * `header` is in display order; each row is a plain object keyed by `header` entries
 * (via the parallel `keys` array) so a caller can render a <TableCell> per key or build a
 * CSV/XLSX row without a report-specific switch of its own.
 */
export interface ReportTable {
  keys: string[];
  header: string[];
  rows: Record<string, string | number>[];
}

const EMPTY: ReportTable = { keys: [], header: [], rows: [] };

function toRows<T>(
  keys: string[],
  header: string[],
  items: readonly T[]
): ReportTable {
  return {
    keys,
    header,
    rows: items.map((item) => {
      const record = item as unknown as Record<string, unknown>;
      return Object.fromEntries(keys.map((k) => [k, formatCell(record[k])])) as Record<string, string | number>;
    }),
  };
}

function formatCell(value: unknown): string | number {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value;
  return String(value);
}

/**
 * `performance` is deliberately excluded — it already has its own table (Analytics.tsx's
 * `PerformanceSection`) and its own export (`/api/analytics/export`), which carries
 * per-doer drill-down the generic shape here doesn't need to duplicate.
 */
export async function fetchReportTable(
  reportId: string,
  range: DateRange,
  scope: ReportScope,
  viewer: ReportViewer
): Promise<ReportTable> {
  switch (reportId) {
    case "tasks": {
      const rows = await readPerf04TaskInputs(range, viewer.userId, false);
      return toRows(
        ["Task_ID", "Title", "Status", "Priority", "Due_Date", "Created_At", "On_Time_Count", "Delay_Count"],
        ["Task ID", "Title", "Status", "Priority", "Due Date", "Created At", "On Time Count", "Delay Count"],
        rows
      );
    }
    case "delegation": {
      const rows = (await readPerf04TaskInputs(range, viewer.userId, true)).filter(
        (t) => t.Assigned_To !== viewer.userId || t.Assigned_By === viewer.userId
      );
      return toRows(
        ["Task_ID", "Title", "Assigned_To", "Status", "Priority", "Due_Date", "Created_At"],
        ["Task ID", "Title", "Assigned To", "Status", "Priority", "Due Date", "Created At"],
        rows.filter((t) => t.Assigned_By === viewer.userId)
      );
    }
    case "recurring": {
      const rows = await listRecurringRows(scope, viewer);
      return toRows(
        ["id", "task", "doerId", "assignedBy", "frequency", "status", "assignDate", "createdAt"],
        ["Recurring ID", "Task", "Doer", "Assigned By", "Frequency", "Status", "Assign Date", "Created At"],
        rows
      );
    }
    case "inward": {
      const rows = await readPerf04ReportRows("inward", range, scope, viewer);
      return toRows(
        ["Timestamp", "IQC_Status", "Created_By"],
        ["Timestamp", "IQC Status", "Created By"],
        rows
      );
    }
    case "iqc": {
      const rows = await readPerf04ReportRows("failures", range, scope, viewer);
      return toRows(
        ["Timestamp", "Fail_Qty", "UOM", "Fail_Reason", "Verified_By"],
        ["Timestamp", "Fail Qty", "UOM", "Fail Reason", "Verified By"],
        rows
      );
    }
    case "ims": {
      const rows = await readPerf04ReportRows("ims", range, scope, viewer);
      return toRows(
        ["Timestamp", "Pass_Qty", "UOM", "Party_Name", "Verified_By"],
        ["Timestamp", "Pass Qty", "UOM", "Party Name", "Verified By"],
        rows
      );
    }
    case "inventory":
    case "finished-goods": {
      const snapshot = await getInventorySnapshot();
      const items = snapshot.items.filter((i) => reportId === "inventory" || i.item.Category === "FG");
      return toRows(
        ["SKU", "Item_Name", "UOM", "Category", "Location", "status", "onHand", "rop"],
        ["SKU", "Item Name", "UOM", "Category", "Location", "Status", "On Hand", "Reorder Point"],
        items.map((i) => ({ ...i.item, status: i.status, onHand: i.onHand, rop: i.rop ?? "" }))
      );
    }
    case "indents": {
      const rows = await readPerf04ReportRows("indents", range, scope, viewer);
      return toRows(
        ["Timestamp", "Status", "Requested_By", "Approved_By"],
        ["Timestamp", "Status", "Requested By", "Approved By"],
        rows
      );
    }
    case "bom": {
      const rows = await listBomRows(scope, viewer);
      return toRows(
        ["bomId", "productName", "productSku", "version", "status", "lineCount", "createdBy", "createdAt"],
        ["BOM ID", "Product", "SKU", "Version", "Status", "Component Lines", "Created By", "Created At"],
        rows
      );
    }
    case "ppc": {
      const rows = await readPerf04ReportRows("ppc", range, scope, viewer);
      return toRows(
        ["timestamp", "productSku", "status", "plannedQty", "recordedOutputQty", "UOM", "productionDate", "createdBy", "startedBy"],
        ["Created At", "Product SKU", "Status", "Planned Qty", "Recorded Output", "UOM", "Production Date", "Created By", "Started By"],
        rows.map((r) => ({ ...r, recordedOutputQty: r.recordedOutputQty ?? "" }))
      );
    }
    case "leave": {
      const rows = await readPerf04ReportRows("leave", range, scope, viewer);
      return toRows(
        ["createdAt", "status", "leaveType", "doerId", "filedBy"],
        ["Created At", "Status", "Leave Type", "Doer", "Filed By"],
        rows
      );
    }
    case "leads": {
      const rows = await readPerf04ReportRows("leads", range, scope, viewer);
      return toRows(
        ["createdAt", "status", "assignedTo", "createdBy"],
        ["Created At", "Status", "Assigned To", "Created By"],
        rows
      );
    }
    case "orders": {
      const rows = await readPerf04ReportRows("orders", range, scope, viewer);
      return toRows(
        ["createdAt", "status", "orderValue", "createdBy"],
        ["Created At", "Status", "Order Value (INR)", "Created By"],
        rows
      );
    }
    case "pdi": {
      const rows = await readPerf04ReportRows("pdi", range, scope, viewer);
      return toRows(
        ["createdAt", "status", "passedBy"],
        ["Created At", "Status", "Passed By"],
        rows
      );
    }
    case "tms": {
      const rows = await readPerf04ReportRows("tms", range, scope, viewer);
      return toRows(
        ["createdAt", "status", "createdBy"],
        ["Created At", "Status", "Created By"],
        rows
      );
    }
    case "accounts": {
      const [invoices, bills] = await Promise.all([
        readPerf04ReportRows("invoices", range, scope, viewer),
        readPerf04ReportRows("bills", range, scope, viewer),
      ]);
      const combined = [
        ...invoices.map((r) => ({ Type: "Invoice", ...r })),
        ...bills.map((r) => ({ Type: "Bill", ...r })),
      ];
      return toRows(
        ["Type", "createdAt", "status", "amount"],
        ["Type", "Created At", "Status", "Amount (INR)"],
        combined
      );
    }
    case "dispatch": {
      const rows = await readPerf04ReportRows("dispatch", range, scope, viewer);
      return toRows(
        ["createdAt", "status", "assignedTo", "createdBy"],
        ["Created At", "Status", "Assigned To", "Created By"],
        rows
      );
    }
    case "payroll": {
      const { history } = await readPerf04Payroll(range, viewer.userId);
      return toRows(
        ["month", "createdAt", "grossPay", "netPay"],
        ["Month", "Finalized At", "Gross Pay (INR)", "Net Pay (INR)"],
        history
      );
    }
    case "maintenance": {
      const rows = await readPerf04ReportRows("maintenance", range, scope, viewer);
      return toRows(
        ["createdAt", "status", "line", "reportedBy", "assignedTo", "workingMinutesLost"],
        ["Created At", "Status", "Line", "Reported By", "Assigned To", "Working Minutes Lost"],
        rows.map((r) => ({ ...r, workingMinutesLost: r.workingMinutesLost ?? "" }))
      );
    }
    default:
      return EMPTY;
  }
}
