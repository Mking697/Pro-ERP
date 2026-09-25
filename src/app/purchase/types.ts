export interface PoLine {
  id: string;
  indentId: string;
  sku: string;
  itemName: string;
  uom: string;
  qty: number;
  oldPrice: string;
  newPrice: string;
  indentStatus: string;
  receivedQty: string;
}

export interface PoOrder {
  id: string;
  vendorId: string;
  vendorName: string;
  status: string;
  attachmentUrl: string;
  invoiceUrl: string;
  issuedBy: string;
  issuedAt: string;
  followUpDueAt: string;
  followUpDoneBy: string;
  followUpDoneAt: string;
  followUpRemark: string;
  materialReceivedDueAt: string;
  gstPercent: number;
  termsAndConditions: string;
  note: string;
  lines: PoLine[];
}
