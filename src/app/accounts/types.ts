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

// --- Payables (mirrors Receivables above, against a Purchase Order) --------------------

export type BillStatus = "Draft" | "Issued";
export type BillPaymentMode =
  | "Cash"
  | "UPI"
  | "Bank_Transfer"
  | "Cheque"
  | "Card"
  | "Credit_Note"
  | "Debit_Note"
  | "Other";

export interface BillCandidateRow {
  poId: string;
  vendorId: string;
  vendorName: string;
  poValue: number;
  issuedAt: string;
}

export interface BillRow {
  id: string;
  poId: string;
  vendorId: string;
  vendorName: string;
  billNo: string;
  billAttachmentUrl: string;
  amount: number;
  status: BillStatus;
  issuedBy: string;
  issuedAt: string;
  createdBy: string;
  createdAt: string;
}

export interface BillPaymentRow {
  id: string;
  billId: string;
  amount: number;
  mode: BillPaymentMode;
  reference: string;
  paidAt: string;
  recordedBy: string;
}

export interface BillDetailRow {
  bill: BillRow;
  totalPaid: number;
  payments: BillPaymentRow[];
}

// --- Ledger (Chart of Accounts, Trial Balance, P&L, Balance Sheet) ---------------------

export type AccountType = "Asset" | "Liability" | "Equity" | "Income" | "Expense";

export interface ChartOfAccountRow {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  isSystem: boolean;
  createdAt: string;
}

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  debit: number;
  credit: number;
}

export interface ProfitAndLossLine {
  code: string;
  name: string;
  amount: number;
}

export interface ProfitAndLossRow {
  income: ProfitAndLossLine[];
  expense: ProfitAndLossLine[];
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
}

export interface BalanceSheetLine {
  code: string;
  name: string;
  amount: number;
}

export interface BalanceSheetRow {
  assets: BalanceSheetLine[];
  liabilities: BalanceSheetLine[];
  equity: BalanceSheetLine[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
}

// --- Additional Payments (a one-off Cash/Bank expense, not tied to any order/PO) -------

export interface ExpenseEntryRow {
  id: string;
  entryDate: string;
  categoryAccountId: string;
  categoryName: string;
  description: string;
  paidTo: string;
  amount: number;
  attachmentUrl: string;
  createdBy: string;
  createdAt: string;
}

// --- Petty Cash Book ---------------------------------------------------------------------

export type PettyCashKind = "TopUp" | "Expense";

export interface PettyCashEntryRow {
  id: string;
  entryDate: string;
  kind: PettyCashKind;
  counterAccountId: string;
  counterAccountName: string;
  description: string;
  amount: number;
  attachmentUrl: string;
  createdBy: string;
  createdAt: string;
  balanceAfter: number;
}

// --- Credit Notes (the reverse of an Invoice — Sales Return, Transit Loss, Price Adjustment) ---

export type CreditNoteReason = "Sales_Return" | "Transit_Loss" | "Price_Adjustment" | "Other";

export interface CreditNoteRow {
  id: string;
  creditNoteNo: string;
  invoiceId: string;
  orderId: string;
  customerId: string;
  customerName: string;
  reason: string;
  amount: number;
  gstAmount: number;
  remainingBalance: number;
  attachmentUrl: string;
  createdBy: string;
  createdAt: string;
}

// --- Debit Notes (the Payables mirror of a Credit Note — a claim against a vendor) -----

export type DebitNoteReason = "IQC_Fail" | "Other";

export interface DebitNoteRow {
  id: string;
  debitNoteNo: string;
  vendorId: string;
  vendorName: string;
  reason: string;
  linkedFailureLogId: string;
  amount: number;
  remainingBalance: number;
  attachmentUrl: string;
  createdBy: string;
  createdAt: string;
}
