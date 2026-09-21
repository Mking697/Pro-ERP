export type LeadStatus =
  | "New"
  | "Qualified"
  | "Junk"
  | "Follow_Up"
  | "Meeting_Scheduled"
  | "Negotiation"
  | "Quotation_Sent"
  | "Order_Confirmed"
  | "Lost";

export interface LeadRow {
  id: string;
  personName: string;
  phone: string;
  email: string;
  companyName: string;
  city: string;
  state: string;
  source: string;
  productInterest: string;
  message: string;
  status: LeadStatus;
  assignedTo: string;
  nextFollowUpAt: string;
  meetingAt: string;
  meetingMode: string;
  lostReason: string;
  createdBy: string;
  createdAt: string;
}

export interface LeadActivityRow {
  id: string;
  leadId: string;
  kind: string;
  message: string;
  actorId: string;
  createdAt: string;
}

export type QuotationStatus = "Draft" | "Sent" | "Accepted" | "Rejected" | "Expired";

export interface QuotationItemRow {
  lineNo: string;
  particular: string;
  specification: string;
  description: string;
  uom: string;
  qtyFormula: string;
  qty: number;
  rate: number;
  amount: number;
}

export interface QuotationRow {
  id: string;
  quotationNo: string;
  status: QuotationStatus;
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
  shippingPartyName: string;
  shippingContactPerson: string;
  shippingAddress: string;
  shippingCity: string;
  shippingState: string;
  shippingPincode: string;
  subject: string;
  note: string;
  terms: string;
  subTotal: number;
  freightAmount: number;
  gstPercent: number;
  gstAmount: number;
  payableAmount: number;
  validUntil: string;
  sentAt: string;
  acceptedAt: string;
  attachmentUrl: string;
  createdBy: string;
  createdAt: string;
  items: QuotationItemRow[];
}

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  New: "New",
  Qualified: "Qualified",
  Junk: "Junk",
  Follow_Up: "Follow Up",
  Meeting_Scheduled: "Meeting Scheduled",
  Negotiation: "Negotiation",
  Quotation_Sent: "Quotation Sent",
  Order_Confirmed: "Order Confirmed",
  Lost: "Lost",
};
