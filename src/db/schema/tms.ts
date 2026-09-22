import { numeric, pgEnum, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./platform";

/**
 * TMS (Transport Management System) — leg 4 of the Sales chain (Lead -> Order -> PDI -> TMS
 * -> Dispatch, Dispatch not built yet). Branches on `orders.transportArrangedBy`:
 *
 * - **Self** ("Freight Paid"): the company books the vehicle — a Transport Vendor, vehicle
 *   size/price, route, and which order lines/quantities ride on it (an order can need
 *   several shipments, e.g. two trucks for one large order — confirmed with the user).
 *   `vehiclePrice` (freight) feeds into Accounts' Invoice `finalValue` (src/db/schema/
 *   accounts.ts) when this leg was self-arranged.
 * - **Party** ("To Pay"): the customer arranges their own pickup — no vendor/vehicle/freight
 *   to plan, just a Follow-up reminder and, when it shows up, a Loading-Dock confirmation
 *   (vehicle no/driver, if known, captured at that point rather than in advance).
 *
 * Both branches use the same `tms_shipments` row shape — one row per physical vehicle used,
 * regardless of who arranged it — so "is this order's transport handled" is always one kind
 * of query, not two.
 */

export const transportVendorStatusEnum = pgEnum("transport_vendor_status", ["Active", "Inactive"]);

/** Mirrors vendors/customers (src/db/schema/parties.ts) exactly, kept in this file instead
 * since it's specific to TMS's own domain rather than the general Purchase/Sales party
 * book. */
export const transportVendors = pgTable("transport_vendors", {
  // Transport_Vendor_ID, e.g. "TRV-xxxx".
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  vendorName: text("vendor_name").notNull(),
  contactPerson: text("contact_person").notNull().default(""),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  gstin: text("gstin").notNull().default(""),
  address: text("address").notNull().default(""),
  city: text("city").notNull().default(""),
  state: text("state").notNull().default(""),
  status: transportVendorStatusEnum("status").notNull().default("Active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by").notNull().default(""),
});

// "Pending" covers both a Self-arranged shipment still being planned/awaited and a
// Party-arranged one still being followed up on — the distinction is which fields are
// filled in, not a separate status (mirrors PDI's own deliberately small status enum).
export const tmsShipmentStatusEnum = pgEnum("tms_shipment_status", ["Pending", "At_Loading_Dock"]);

export const tmsShipments = pgTable("tms_shipments", {
  // Shipment_ID, e.g. "TMS-xxxx".
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  orderId: text("order_id").notNull(),
  // "" for a Party-arranged shipment — there is no vendor/price to plan.
  transportVendorId: text("transport_vendor_id").notNull().default(""),
  vehicleSize: text("vehicle_size").notNull().default(""),
  // Freight cost — only meaningful when Self-arranged; "0" for Party (To Pay, the customer
  // bears it, it is never this org's cost or revenue).
  vehiclePrice: numeric("vehicle_price").notNull().default("0"),
  fromWarehouse: text("from_warehouse").notNull().default(""),
  toAddress: text("to_address").notNull().default(""),
  vehicleNo: text("vehicle_no").notNull().default(""),
  driverContactNo: text("driver_contact_no").notNull().default(""),
  status: tmsShipmentStatusEnum("status").notNull().default("Pending"),
  loadingDockConfirmedBy: text("loading_dock_confirmed_by").notNull().default(""),
  loadingDockConfirmedAt: timestamp("loading_dock_confirmed_at", { withTimezone: true }),
  createdBy: text("created_by").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One row per (shipment, order line) — how much of that line's quantity rides on this
 * particular vehicle. Composite PK (shipment_id, line_no), same flat-rows-by-group shape as
 * quotation_items/order_items. "How much of an order's own line is still unshipped" is
 * always a live sum across every one of its shipments' rows here, never stored on the order
 * line itself.
 */
export const tmsShipmentItems = pgTable(
  "tms_shipment_items",
  {
    shipmentId: text("shipment_id").notNull(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    lineNo: text("line_no").notNull(),
    sku: text("sku").notNull(),
    itemName: text("item_name").notNull().default(""),
    uom: text("uom").notNull().default(""),
    qty: numeric("qty").notNull().default("0"),
  },
  (table) => [primaryKey({ columns: [table.shipmentId, table.lineNo] })]
);

// TmsActivityRecord.Kind — one row per event, append-only, same convention as
// order_activities/pdi_activities. Scoped to orderId (not shipmentId): an order can have
// several shipments, and its TMS timeline is read as one story, not one per truck.
export const tmsActivityKindEnum = pgEnum("tms_activity_kind", [
  "Note",
  "Shipment_Planned",
  "Follow_Up",
  "Loading_Dock_Confirmed",
]);

export const tmsActivities = pgTable("tms_activities", {
  // Activity_ID, e.g. "TMA-xxxx".
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  orderId: text("order_id").notNull(),
  kind: tmsActivityKindEnum("kind").notNull(),
  message: text("message").notNull(),
  actorId: text("actor_id").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
