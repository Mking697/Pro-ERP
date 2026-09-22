export type TmsShipmentStatus = "Pending" | "At_Loading_Dock";

export interface TmsShipmentItemRow {
  lineNo: string;
  sku: string;
  itemName: string;
  uom: string;
  qty: number;
}

export interface TmsShipmentRow {
  id: string;
  orderId: string;
  transportVendorId: string;
  vendorName: string;
  vehicleSize: string;
  vehiclePrice: number;
  fromWarehouse: string;
  toAddress: string;
  vehicleNo: string;
  driverContactNo: string;
  status: TmsShipmentStatus;
  loadingDockConfirmedBy: string;
  loadingDockConfirmedAt: string;
  createdBy: string;
  createdAt: string;
  items: TmsShipmentItemRow[];
}

export interface TmsShipmentListRow extends TmsShipmentRow {
  partyName: string;
}

export interface TmsActivityRow {
  id: string;
  orderId: string;
  kind: string;
  message: string;
  actorId: string;
  createdAt: string;
}

export interface TmsLineProgress {
  lineNo: string;
  sku: string;
  itemName: string;
  uom: string;
  qty: number;
  shippedQty: number;
  remainingQty: number;
}

export interface TmsShipmentProgress {
  lines: TmsLineProgress[];
  fullyShipped: boolean;
  partiallyShipped: boolean;
}

// Mirrors OrderRow (src/app/orders/types.ts) — duplicated here rather than imported so this
// page never pulls a server-only module transitively into a "use client" file, matching
// this codebase's own orders/pdi types.ts convention.
export interface TmsOrderRow {
  id: string;
  source: string;
  transportArrangedBy: "Self" | "Party" | null;
  partyName: string;
  orderValue: number;
  shippingAddress: string;
  shippingCity: string;
  shippingState: string;
  dispatchCommitDate: string;
  createdAt: string;
  items: {
    lineNo: string;
    sku: string;
    itemName: string;
    uom: string;
    qty: number;
    rate: number;
    amount: number;
    reservedQty: number;
    shortageQty: number;
  }[];
}

export interface TmsOrderCandidateRow {
  order: TmsOrderRow;
  progress: TmsShipmentProgress;
  needsTransportDecision: boolean;
}

export interface TmsOrderDetailRow {
  order: TmsOrderRow;
  progress: TmsShipmentProgress;
  shipments: TmsShipmentRow[];
  activities: TmsActivityRow[];
}

export interface TransportVendorRow {
  Vendor_ID: string;
  Vendor_Name: string;
  Contact_Person: string;
  Phone: string;
  Email: string;
  GSTIN: string;
  Address: string;
  City: string;
  State: string;
  Status: string;
  Created_At: string;
  Created_By: string;
}
