export type DispatchStatus = "In_Transit" | "Dispatched" | "Delivered";

export interface DispatchItemRow {
  lineNo: string;
  sku: string;
  itemName: string;
  uom: string;
  qty: number;
}

export interface DispatchRow {
  id: string;
  orderId: string;
  shipmentId: string;
  gatePassNo: string;
  gatePassAttachmentUrl: string;
  assignedTo: string;
  assignedToName: string;
  tatValue: number;
  tatUnit: string;
  tatDeadline: string;
  status: DispatchStatus;
  proofOfDispatchUrl: string;
  dispatchedBy: string;
  dispatchedAt: string;
  podAttachmentUrl: string;
  deliveredBy: string;
  deliveredAt: string;
  createdBy: string;
  createdAt: string;
  items: DispatchItemRow[];
}

export interface DispatchListRow extends DispatchRow {
  partyName: string;
  orderFullyDispatched: boolean;
  orderFullyDelivered: boolean;
}

export interface DispatchActivityRow {
  id: string;
  orderId: string;
  kind: string;
  message: string;
  actorId: string;
  createdAt: string;
}

// Mirrors OrderRow duplicated in src/app/tms/types.ts and src/app/pdi/types.ts's own
// convention — this page never pulls a server-only module transitively into a "use client"
// file this way.
export interface DispatchOrderRow {
  id: string;
  partyName: string;
  orderValue: number;
  createdAt: string;
}

export interface DispatchCandidateShipmentRow {
  id: string;
  orderId: string;
  vendorName: string;
  vehicleSize: string;
  fromWarehouse: string;
  toAddress: string;
  vehicleNo: string;
  driverContactNo: string;
  loadingDockConfirmedAt: string;
  createdAt: string;
  items: DispatchItemRow[];
}

export interface DispatchCandidateRow {
  shipment: DispatchCandidateShipmentRow;
  order: DispatchOrderRow;
  invoiceIssued: boolean;
}

export interface DispatchDetailRow {
  dispatch: DispatchRow;
  order: DispatchOrderRow;
  activities: DispatchActivityRow[];
  orderFullyDispatched: boolean;
  orderFullyDelivered: boolean;
}

export interface UserOption {
  userId: string;
  fullName: string;
  role: string;
  department: string;
}
