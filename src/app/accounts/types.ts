export type InvoiceStatus = "Draft" | "Issued";

export interface InvoiceRow {
  id: string;
  orderId: string;
  invoiceNo: string;
  invoiceAttachmentUrl: string;
  ewayBillNo: string;
  ewayBillAttachmentUrl: string;
  extraDocumentUrl: string;
  finalValue: number;
  status: InvoiceStatus;
  issuedBy: string;
  issuedAt: string;
  createdBy: string;
  createdAt: string;
}

// Mirrors OrderRow (src/app/orders/types.ts), duplicated for the same "no server-only
// import into a client file" reasoning as src/app/tms/types.ts.
export interface AccountsOrderRow {
  id: string;
  partyName: string;
  orderValue: number;
  transportArrangedBy: "Self" | "Party" | null;
  createdAt: string;
}

export interface InvoiceDetailRow {
  invoice: InvoiceRow;
  order: AccountsOrderRow;
  totalReceived: number;
}

export interface InvoiceSuggestionRow {
  orderValue: number;
  freightTotal: number;
  suggestedFinalValue: number;
}
