export type PdiStatus = "Pending" | "Passed";

export interface PdiOrderItemRow {
  lineNo: string;
  sku: string;
  itemName: string;
  uom: string;
  qty: number;
  rate: number;
  amount: number;
  reservedQty: number;
  shortageQty: number;
}

export interface PdiOrderRow {
  id: string;
  partyName: string;
  orderValue: number;
  dispatchCommitDate: string;
  items: PdiOrderItemRow[];
}

export interface PdiInspectionRow {
  id: string;
  orderId: string;
  status: PdiStatus;
  dueAt: string;
  attachmentUrl: string;
  passedBy: string;
  passedAt: string;
  createdAt: string;
  waitingForStock: boolean;
  order: PdiOrderRow;
}

export interface PdiActivityRow {
  id: string;
  pdiId: string;
  kind: string;
  message: string;
  attachmentUrl: string;
  actorId: string;
  createdAt: string;
}

export const PDI_STATUS_LABEL: Record<PdiStatus, string> = {
  Pending: "Pending",
  Passed: "Passed",
};
