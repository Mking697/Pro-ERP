export type OrderStatus =
  | "Items_Pending"
  | "Payment_Review"
  | "Credit_Hold"
  | "Stock_Check"
  | "Dispatch_Pending"
  | "Ready_For_PDI"
  | "Cancelled";

export interface OrderItemRow {
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

export interface OrderRow {
  id: string;
  source: string;
  leadId: string;
  quotationId: string;
  customerId: string;
  partyName: string;
  contactPerson: string;
  customerMobile: string;
  customerEmail: string;
  customerGst: string;
  billingAddress: string;
  billingCity: string;
  billingState: string;
  billingPincode: string;
  shippingPartyName: string;
  shippingContactPerson: string;
  shippingAddress: string;
  shippingCity: string;
  shippingState: string;
  shippingPincode: string;
  poAttachmentUrl: string;
  status: OrderStatus;
  orderValue: number;
  creditApprovedBy: string;
  creditApprovedAt: string;
  dispatchCommitDate: string;
  createdBy: string;
  createdAt: string;
  items: OrderItemRow[];
}

export interface OrderActivityRow {
  id: string;
  orderId: string;
  kind: string;
  message: string;
  actorId: string;
  createdAt: string;
}

export interface OrderPaymentRow {
  id: string;
  orderId: string;
  amount: number;
  mode: string;
  reference: string;
  receivedAt: string;
  recordedBy: string;
  createdAt: string;
}

export interface IntakeItem {
  lineNo: string;
  particular: string;
  description: string;
  uom: string;
  qty: number;
  rate: number;
  amount: number;
}

export interface IntakeCandidate {
  quotationId: string;
  quotationNo: string;
  leadId: string;
  partyName: string;
  contactPerson: string;
  customerMobile: string;
  customerEmail: string;
  customerGst: string;
  billingAddress: string;
  billingCity: string;
  billingState: string;
  billingPincode: string;
  payableAmount: number;
  acceptedAt: string;
  items: IntakeItem[];
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  Items_Pending: "Items Pending",
  Payment_Review: "Payment Review",
  Credit_Hold: "Credit Hold",
  Stock_Check: "Stock Check",
  Dispatch_Pending: "Dispatch Pending",
  Ready_For_PDI: "Ready For PDI",
  Cancelled: "Cancelled",
};
