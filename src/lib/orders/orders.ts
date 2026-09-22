import type { InferSelectModel } from "drizzle-orm";
import { and, desc, eq } from "drizzle-orm";
import {
  customers,
  orderActivities,
  orderItems,
  orderPayments,
  orders,
  quotationItems,
  quotations,
} from "@/db/schema";
import { db } from "@/db/client";
import { findById, insertRecord, listByOrg, updateById } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { findItem } from "@/lib/inventory/items";
import { listLedger, onHandBySku, positionFor } from "@/lib/inventory/ledger";
import { committedBySku } from "@/lib/inventory/plans";
import { inTransitBySku } from "@/lib/inventory/indents";
import { round2, round3, lineAmount } from "@/lib/leads/quotationMath";
import { createCustomer } from "@/lib/parties/customers";
import { emitFmsEvent } from "@/lib/fms/engine";
import { createTask } from "@/lib/tasks";
import { sendWhatsAppMessage } from "@/lib/chatxflow";
import { listUsers } from "@/lib/auth/users";
import { effectiveModuleAccess, type ModuleAccessKey } from "@/lib/moduleAccess";
import { getOrderSetup } from "@/lib/orders/settings";

/**
 * Order FMS — leg 2 of the Sales chain (Lead -> Order -> PDI -> Dispatch). Built as its own
 * hardcoded flow, not a generic FMS Template, matching Purchase FMS's precedent (see
 * CLAUDE.md). See src/db/schema/orders.ts's own header comment for the full design
 * reasoning behind every column here.
 */

export class OrderError extends Error {}

export type OrderStatus =
  | "Items_Pending"
  | "Payment_Review"
  | "Credit_Hold"
  | "Stock_Check"
  | "Dispatch_Pending"
  | "Ready_For_PDI"
  | "Cancelled";

export type OrderActivityKind =
  | "Note"
  | "Status_Change"
  | "Items_Mapped"
  | "Payment"
  | "Credit_Hold"
  | "Credit_Approved"
  | "Stock_Reserved"
  | "Shortage_Notified"
  | "Dispatch_Committed"
  | "Cancelled";

export type OrderPaymentMode = "Cash" | "UPI" | "Bank_Transfer" | "Cheque" | "Card" | "Other";

/** Terminal — nothing in this module can move an order out of these. Ready_For_PDI is
 * Order FMS's own successful end (a future PDI module picks up from there); Cancelled is
 * reachable from every other status. */
const TERMINAL_STATUSES: readonly OrderStatus[] = ["Ready_For_PDI", "Cancelled"];

/** The statuses whose order_items.reservedQty actually holds real FG stock — mirrors
 * plans.ts's own RESERVING set for raw material, one level up the chain. Not
 * Items_Pending/Payment_Review/Credit_Hold: nothing has been checked against stock yet. */
const RESERVING_ORDER_STATUSES: readonly OrderStatus[] = [
  "Stock_Check",
  "Dispatch_Pending",
  "Ready_For_PDI",
];

export interface OrderItemRecord {
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

export interface OrderRecord {
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
  items: OrderItemRecord[];
}

export interface OrderActivityRecord {
  id: string;
  orderId: string;
  kind: OrderActivityKind;
  message: string;
  actorId: string;
  createdAt: string;
}

export interface OrderPaymentRecord {
  id: string;
  orderId: string;
  amount: number;
  mode: OrderPaymentMode;
  reference: string;
  receivedAt: string;
  recordedBy: string;
  createdAt: string;
}

type OrderRow = InferSelectModel<typeof orders>;
type OrderItemRow = InferSelectModel<typeof orderItems>;
type OrderActivityRow = InferSelectModel<typeof orderActivities>;
type OrderPaymentRow = InferSelectModel<typeof orderPayments>;

function rowToItem(row: OrderItemRow): OrderItemRecord {
  return {
    lineNo: row.lineNo,
    sku: row.sku,
    itemName: row.itemName,
    uom: row.uom,
    qty: Number(row.qty) || 0,
    rate: Number(row.rate) || 0,
    amount: Number(row.amount) || 0,
    reservedQty: Number(row.reservedQty) || 0,
    shortageQty: Number(row.shortageQty) || 0,
  };
}

function rowToOrder(row: OrderRow, items: OrderItemRecord[]): OrderRecord {
  return {
    id: row.id,
    source: row.source,
    leadId: row.leadId,
    quotationId: row.quotationId,
    customerId: row.customerId,
    partyName: row.partyName,
    contactPerson: row.contactPerson,
    customerMobile: row.customerMobile,
    customerEmail: row.customerEmail,
    customerGst: row.customerGst,
    billingAddress: row.billingAddress,
    billingCity: row.billingCity,
    billingState: row.billingState,
    billingPincode: row.billingPincode,
    shippingPartyName: row.shippingPartyName,
    shippingContactPerson: row.shippingContactPerson,
    shippingAddress: row.shippingAddress,
    shippingCity: row.shippingCity,
    shippingState: row.shippingState,
    shippingPincode: row.shippingPincode,
    poAttachmentUrl: row.poAttachmentUrl,
    status: row.status,
    orderValue: Number(row.orderValue) || 0,
    creditApprovedBy: row.creditApprovedBy,
    creditApprovedAt: row.creditApprovedAt ? row.creditApprovedAt.toISOString() : "",
    dispatchCommitDate: row.dispatchCommitDate ? row.dispatchCommitDate.toISOString() : "",
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    items,
  };
}

function rowToActivity(row: OrderActivityRow): OrderActivityRecord {
  return {
    id: row.id,
    orderId: row.orderId,
    kind: row.kind,
    message: row.message,
    actorId: row.actorId,
    createdAt: row.createdAt.toISOString(),
  };
}

function rowToPayment(row: OrderPaymentRow): OrderPaymentRecord {
  return {
    id: row.id,
    orderId: row.orderId,
    amount: Number(row.amount) || 0,
    mode: row.mode,
    reference: row.reference,
    receivedAt: row.receivedAt.toISOString(),
    recordedBy: row.recordedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

async function loadOrderItems(orgId: string, orderId: string): Promise<OrderItemRecord[]> {
  const rows = await db
    .select()
    .from(orderItems)
    .where(and(eq(orderItems.orgId, orgId), eq(orderItems.orderId, orderId)));
  return rows.map(rowToItem).sort((a, b) => Number(a.lineNo) - Number(b.lineNo));
}

async function logOrderActivity(
  orgId: string,
  orderId: string,
  kind: OrderActivityKind,
  message: string,
  actorId: string
): Promise<void> {
  await insertRecord(orderActivities, {
    id: generateId("OAC"),
    orgId,
    orderId,
    kind,
    message,
    actorId,
  });
}

export async function getOrder(orderId: string): Promise<OrderRecord | null> {
  const orgId = await getTenantOrgId();
  const row = await findById(orders, orgId, orderId);
  if (!row) return null;
  const items = await loadOrderItems(orgId, orderId);
  return rowToOrder(row, items);
}

export async function listOrders(status?: OrderStatus): Promise<OrderRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = status
    ? await db.select().from(orders).where(and(eq(orders.orgId, orgId), eq(orders.status, status)))
    : await listByOrg(orders, orgId);

  const result: OrderRecord[] = [];
  for (const row of rows) {
    result.push(rowToOrder(row, await loadOrderItems(orgId, row.id)));
  }
  return result.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function listOrderActivities(orderId: string): Promise<OrderActivityRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select()
    .from(orderActivities)
    .where(and(eq(orderActivities.orgId, orgId), eq(orderActivities.orderId, orderId)))
    .orderBy(desc(orderActivities.createdAt));
  return rows.map(rowToActivity);
}

export async function listOrderPayments(orderId: string): Promise<OrderPaymentRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select()
    .from(orderPayments)
    .where(and(eq(orderPayments.orgId, orgId), eq(orderPayments.orderId, orderId)))
    .orderBy(desc(orderPayments.receivedAt));
  return rows.map(rowToPayment);
}

// ---------------------------------------------------------------------------
// Stock reservation — the fourth commitment source (see src/lib/inventory/ledger.ts)
// ---------------------------------------------------------------------------

/**
 * FG stock reserved against Orders, summed per SKU — the exact mirror of
 * src/lib/inventory/plans.ts's own committedBySku(), one level up the chain (raw material
 * reservation for production vs. finished-goods reservation for a sale). Lives here, not in
 * ledger.ts/service.ts, because Orders own the data it's derived from — same reasoning
 * plans.ts's own doc comment gives for committedBySku().
 *
 * Deliberately computed here from ledger.ts/plans.ts/indents.ts directly rather than by
 * calling service.ts's freeStockFor()/getInventorySnapshot(): those two now call THIS
 * function to build their own free-stock maps, so calling back into them here would be a
 * real circular import (mirrors why plans.ts's hasFmsLine() imports fms/engine.ts
 * dynamically instead of statically) — this file simply never imports service.ts at all.
 */
export async function orderReservedBySku(): Promise<Map<string, number>> {
  const orgId = await getTenantOrgId();
  const [orderRows, itemRows] = await Promise.all([
    listByOrg(orders, orgId).catch(() => [] as OrderRow[]),
    listByOrg(orderItems, orgId).catch(() => [] as OrderItemRow[]),
  ]);

  const reserving = new Set(
    orderRows.filter((o) => RESERVING_ORDER_STATUSES.includes(o.status)).map((o) => o.id)
  );

  const out = new Map<string, number>();
  for (const row of itemRows) {
    if (!reserving.has(row.orderId) || !row.sku) continue;
    const qty = Number(row.reservedQty) || 0;
    if (qty <= 0) continue;
    out.set(row.sku, round3((out.get(row.sku) ?? 0) + qty));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Customer resolution — shared by both entry paths
// ---------------------------------------------------------------------------

export interface NewCustomerInput {
  customerName: string;
  phone?: string;
  email?: string;
  gstin?: string;
  billingAddress?: string;
  city?: string;
  state?: string;
}

interface ResolvedCustomer {
  customerId: string;
  customerName: string;
  contactPerson: string;
  phone: string;
  email: string;
  gstin: string;
  billingAddress: string;
  shippingAddress: string;
  city: string;
  state: string;
}

/**
 * "Existing Customer" / "New Customer", scoped exactly like Lead FMS's own walk-in
 * quotation flow (src/app/leads/walk-in-quotation-dialog.tsx) — the caller (an API route)
 * is responsible for scoping which existing customers a picker even shows; this function
 * just resolves whichever one was actually chosen or creates a new one.
 *
 * JUDGMENT CALL: createCustomer() has no creditLimit/creditDays parameters (Customer
 * Master's own manual-add form doesn't collect them either) — a brand-new customer added
 * on the spot here starts with no credit extended, which is the safe default (an order
 * against them requires an advance before Payment_Review can pass). An Admin can add credit
 * terms afterwards from Parties.
 */
async function resolveCustomer(
  orgId: string,
  input: { customerId?: string; newCustomer?: NewCustomerInput },
  createdBy: string
): Promise<ResolvedCustomer> {
  if (input.customerId) {
    const row = await findById(customers, orgId, input.customerId);
    if (!row) throw new OrderError("Customer nahi mila.");
    return {
      customerId: row.id,
      customerName: row.customerName,
      contactPerson: row.contactPerson,
      phone: row.phone,
      email: row.email,
      gstin: row.gstin,
      billingAddress: row.billingAddress,
      shippingAddress: row.shippingAddress,
      city: row.city,
      state: row.state,
    };
  }

  if (input.newCustomer?.customerName?.trim()) {
    const { customer } = await createCustomer({
      customerName: input.newCustomer.customerName,
      phone: input.newCustomer.phone,
      email: input.newCustomer.email,
      gstin: input.newCustomer.gstin,
      billingAddress: input.newCustomer.billingAddress,
      city: input.newCustomer.city,
      state: input.newCustomer.state,
      createdBy,
    });
    return {
      customerId: customer.Customer_ID,
      customerName: customer.Customer_Name,
      contactPerson: customer.Contact_Person,
      phone: customer.Phone,
      email: customer.Email,
      gstin: customer.GSTIN,
      billingAddress: customer.Billing_Address,
      shippingAddress: customer.Shipping_Address,
      city: customer.City,
      state: customer.State,
    };
  }

  throw new OrderError("Ek Customer chunein ya naya Customer ka naam bharein.");
}

// ---------------------------------------------------------------------------
// Entry path 1 — Lead-sourced intake queue
// ---------------------------------------------------------------------------

export interface OrderIntakeItem {
  lineNo: string;
  particular: string;
  description: string;
  uom: string;
  qty: number;
  rate: number;
  amount: number;
}

export interface OrderIntakeCandidate {
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
  items: OrderIntakeItem[];
}

/** Every Accepted quotation not yet punched into an Order — mirrors
 * src/lib/purchase/orders.ts's listPurchaseCandidates() (an Approved-but-unbundled indent),
 * one level up the chain. */
export async function listIntakeCandidates(): Promise<OrderIntakeCandidate[]> {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select()
    .from(quotations)
    .where(
      and(eq(quotations.orgId, orgId), eq(quotations.status, "Accepted"), eq(quotations.orderId, ""))
    );

  const result: OrderIntakeCandidate[] = [];
  for (const row of rows) {
    const lineRows = await db
      .select()
      .from(quotationItems)
      .where(and(eq(quotationItems.orgId, orgId), eq(quotationItems.quotationId, row.id)));

    result.push({
      quotationId: row.id,
      quotationNo: row.quotationNo,
      leadId: row.leadId,
      partyName: row.partyName,
      contactPerson: row.contactPerson,
      customerMobile: row.customerMobile,
      customerEmail: row.customerEmail,
      customerGst: row.customerGst,
      billingAddress: row.billingAddress,
      billingCity: row.billingCity,
      billingState: row.billingState,
      billingPincode: row.billingPincode,
      payableAmount: Number(row.payableAmount) || 0,
      acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : "",
      items: lineRows
        .map((l) => ({
          lineNo: l.lineNo,
          particular: l.particular,
          description: l.description,
          uom: l.uom,
          qty: Number(l.qty) || 0,
          rate: Number(l.rate) || 0,
          amount: Number(l.amount) || 0,
        }))
        .sort((a, b) => Number(a.lineNo) - Number(b.lineNo)),
    });
  }

  return result.sort((a, b) => (a.acceptedAt < b.acceptedAt ? 1 : -1));
}

export interface ItemMappingInput {
  /** The quotation_items.lineNo this mapping resolves. */
  lineNo: string;
  sku: string;
}

export interface CreateOrderFromQuotationInput {
  quotationId: string;
  items: ItemMappingInput[];
  customerId?: string;
  newCustomer?: NewCustomerInput;
  poAttachmentUrl?: string;
}

/**
 * Completing Step 1 for a Lead-sourced candidate: maps every quotation line to a real Item,
 * confirms/creates the real Customer Master row, and writes the orders/order_items rows in
 * one action — see src/db/schema/orders.ts's own header comment and CLAUDE.md's Order FMS
 * section for why this is one atomic step rather than a separate "create then map" pair.
 * The order is conceptually "Items_Pending" until this function returns; there is no
 * intermediate DB row sitting in that status, since the whole point of Step 1 is that it
 * cannot be done in pieces (an order with unmapped lines has no real SKU to reserve against
 * anyway).
 */
export async function createOrderFromQuotation(
  input: CreateOrderFromQuotationInput,
  createdBy: string
): Promise<OrderRecord> {
  const orgId = await getTenantOrgId();
  const quotationRow = await findById(quotations, orgId, input.quotationId);
  if (!quotationRow) throw new OrderError("Quotation nahi mila.");
  if (quotationRow.status !== "Accepted") {
    throw new OrderError(
      `Ye quotation "${quotationRow.status}" hai — Order sirf Accepted quotation se banta hai.`
    );
  }
  if (quotationRow.orderId) {
    throw new OrderError("Is quotation se pehle hi ek Order ban chuka hai.");
  }

  const quotationLineRows = await db
    .select()
    .from(quotationItems)
    .where(and(eq(quotationItems.orgId, orgId), eq(quotationItems.quotationId, input.quotationId)));
  if (quotationLineRows.length === 0) {
    throw new OrderError("Is quotation me koi line item nahi hai.");
  }

  const mapByLine = new Map(input.items.map((m) => [m.lineNo, m.sku.trim()]));
  const resolvedLines: {
    lineNo: string;
    sku: string;
    itemName: string;
    uom: string;
    qty: number;
    rate: number;
    amount: number;
  }[] = [];

  for (const line of quotationLineRows) {
    const sku = mapByLine.get(line.lineNo);
    if (!sku) {
      throw new OrderError(
        `Line ${line.lineNo} (${line.particular || line.description || "—"}) ke liye SKU map karna zaroori hai.`
      );
    }
    const item = await findItem(sku);
    if (!item) {
      throw new OrderError(`SKU "${sku}" Items master me nahi hai.`);
    }
    resolvedLines.push({
      lineNo: line.lineNo,
      sku: item.SKU,
      itemName: item.Item_Name,
      uom: item.UOM,
      qty: Number(line.qty) || 0,
      rate: Number(line.rate) || 0,
      amount: Number(line.amount) || 0,
    });
  }

  const customer = await resolveCustomer(orgId, input, createdBy);

  const orderId = generateId("ORD");
  await insertRecord(orders, {
    id: orderId,
    orgId,
    source: "Lead",
    leadId: quotationRow.leadId,
    quotationId: input.quotationId,
    customerId: customer.customerId,
    partyName: customer.customerName,
    contactPerson: customer.contactPerson || quotationRow.contactPerson,
    customerMobile: customer.phone || quotationRow.customerMobile,
    customerEmail: customer.email || quotationRow.customerEmail,
    customerGst: customer.gstin || quotationRow.customerGst,
    billingAddress: customer.billingAddress || quotationRow.billingAddress,
    billingCity: customer.city || quotationRow.billingCity,
    billingState: customer.state || quotationRow.billingState,
    billingPincode: quotationRow.billingPincode,
    shippingPartyName: quotationRow.shippingPartyName || customer.customerName,
    shippingContactPerson: quotationRow.shippingContactPerson || customer.contactPerson,
    shippingAddress: quotationRow.shippingAddress || customer.shippingAddress || customer.billingAddress,
    shippingCity: quotationRow.shippingCity || customer.city,
    shippingState: quotationRow.shippingState || customer.state,
    shippingPincode: quotationRow.shippingPincode,
    poAttachmentUrl: input.poAttachmentUrl?.trim() ?? "",
    status: "Payment_Review",
    orderValue: quotationRow.payableAmount,
    createdBy,
  });

  for (const line of resolvedLines) {
    await insertRecord(orderItems, {
      orderId,
      orgId,
      lineNo: line.lineNo,
      sku: line.sku,
      itemName: line.itemName,
      uom: line.uom,
      qty: String(line.qty),
      rate: String(line.rate),
      amount: String(line.amount),
    });
  }

  await updateById(quotations, orgId, input.quotationId, { orderId });

  await logOrderActivity(
    orgId,
    orderId,
    "Items_Mapped",
    `Quotation ${quotationRow.quotationNo} se order banaya gaya — ${resolvedLines.length} item(s) map kiye gaye, customer confirm kiya gaya. Payment_Review me aage badha.`,
    createdBy
  );

  const created = await getOrder(orderId);
  if (!created) throw new OrderError("Order ban gaya lekin load nahi ho paya.");
  return created;
}

// ---------------------------------------------------------------------------
// Entry path 2 — Direct order form
// ---------------------------------------------------------------------------

export interface DirectOrderItemInput {
  sku: string;
  qty: number;
  rate: number;
}

export interface CreateDirectOrderInput {
  customerId?: string;
  newCustomer?: NewCustomerInput;
  items: DirectOrderItemInput[];
  poAttachmentUrl?: string;
}

/** No Lead/Quotation behind it — a salesperson's own Order Form. Starts straight at
 * Payment_Review since there is nothing to map (every line already names a real SKU). */
export async function createDirectOrder(
  input: CreateDirectOrderInput,
  createdBy: string
): Promise<OrderRecord> {
  if (input.items.length === 0) {
    throw new OrderError("Kam se kam ek item chunein.");
  }

  const orgId = await getTenantOrgId();
  const customer = await resolveCustomer(orgId, input, createdBy);

  const lines: {
    sku: string;
    itemName: string;
    uom: string;
    qty: number;
    rate: number;
    amount: number;
  }[] = [];

  for (const line of input.items) {
    if (!(line.qty > 0)) {
      throw new OrderError("Har item ki quantity 0 se zyada honi chahiye.");
    }
    if (!(line.rate >= 0)) {
      throw new OrderError("Rate negative nahi ho sakta.");
    }
    const item = await findItem(line.sku);
    if (!item) {
      throw new OrderError(`SKU "${line.sku}" Items master me nahi hai.`);
    }
    const qty = round3(line.qty);
    const rate = round2(line.rate);
    lines.push({
      sku: item.SKU,
      itemName: item.Item_Name,
      uom: item.UOM,
      qty,
      rate,
      amount: lineAmount(qty, rate),
    });
  }

  const orderValue = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  const orderId = generateId("ORD");

  await insertRecord(orders, {
    id: orderId,
    orgId,
    source: "Direct",
    leadId: "",
    quotationId: "",
    customerId: customer.customerId,
    partyName: customer.customerName,
    contactPerson: customer.contactPerson,
    customerMobile: customer.phone,
    customerEmail: customer.email,
    customerGst: customer.gstin,
    billingAddress: customer.billingAddress,
    billingCity: customer.city,
    billingState: customer.state,
    billingPincode: "",
    shippingPartyName: customer.customerName,
    shippingContactPerson: customer.contactPerson,
    shippingAddress: customer.shippingAddress || customer.billingAddress,
    shippingCity: customer.city,
    shippingState: customer.state,
    shippingPincode: "",
    poAttachmentUrl: input.poAttachmentUrl?.trim() ?? "",
    status: "Payment_Review",
    orderValue: String(orderValue),
    createdBy,
  });

  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    await insertRecord(orderItems, {
      orderId,
      orgId,
      lineNo: String(i + 1),
      sku: l.sku,
      itemName: l.itemName,
      uom: l.uom,
      qty: String(l.qty),
      rate: String(l.rate),
      amount: String(l.amount),
    });
  }

  await logOrderActivity(
    orgId,
    orderId,
    "Note",
    `Direct order banaya gaya — ${lines.length} item(s), value ₹${orderValue}.`,
    createdBy
  );

  const created = await getOrder(orderId);
  if (!created) throw new OrderError("Order ban gaya lekin load nahi ho paya.");
  return created;
}

// ---------------------------------------------------------------------------
// Payments — recordable at any (non-Cancelled) status
// ---------------------------------------------------------------------------

export interface RecordPaymentInput {
  amount: number;
  mode: OrderPaymentMode;
  reference?: string;
  /** ISO instant — defaults to now. */
  receivedAt?: string;
}

export async function recordPayment(
  orderId: string,
  input: RecordPaymentInput,
  actorId: string
): Promise<OrderRecord> {
  if (!(input.amount > 0)) {
    throw new OrderError("Amount 0 se zyada hona chahiye.");
  }

  const orgId = await getTenantOrgId();
  const order = await findById(orders, orgId, orderId);
  if (!order) throw new OrderError("Order nahi mila.");
  if (order.status === "Cancelled") {
    throw new OrderError("Cancelled order par payment record nahi ho sakta.");
  }

  const amount = round2(input.amount);
  await insertRecord(orderPayments, {
    id: generateId("OPY"),
    orgId,
    orderId,
    amount: String(amount),
    mode: input.mode,
    reference: input.reference?.trim() ?? "",
    receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
    recordedBy: actorId,
  });

  await logOrderActivity(
    orgId,
    orderId,
    "Payment",
    `Payment record kiya gaya — ₹${amount} (${input.mode}).${input.reference ? ` Ref: ${input.reference}` : ""}`,
    actorId
  );

  const updated = await getOrder(orderId);
  if (!updated) throw new OrderError("Payment record ho gaya lekin order load nahi ho paya.");
  return updated;
}

// ---------------------------------------------------------------------------
// Step 2 — Payment_Review's credit gate
// ---------------------------------------------------------------------------

async function sumPaymentsForOrder(orgId: string, orderId: string): Promise<number> {
  const rows = await db
    .select()
    .from(orderPayments)
    .where(and(eq(orderPayments.orgId, orgId), eq(orderPayments.orderId, orderId)));
  return round2(rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0));
}

/**
 * The credit check, worked out fresh every time — never a stored running total, matching
 * this schema's own "no figure is ever stored anywhere" philosophy. Sums outstanding
 * (orderValue - paid) across every non-Cancelled order this customer has (this order
 * included, since it's already a row in `orders` by the time Payment_Review is worked), and
 * separately flags any of those orders whose own `createdAt + creditDays` has already
 * passed while still carrying an outstanding balance.
 */
async function computeCreditPosition(
  orgId: string,
  customerId: string,
  creditLimit: number | null,
  creditDays: number | null
): Promise<{ hold: boolean; reason: string; outstanding: number }> {
  const allOrders = await db
    .select()
    .from(orders)
    .where(and(eq(orders.orgId, orgId), eq(orders.customerId, customerId)));
  const openOrders = allOrders.filter((o) => o.status !== "Cancelled");

  let totalOutstanding = 0;
  let overdueOrderId: string | null = null;

  for (const o of openOrders) {
    const paid = await sumPaymentsForOrder(orgId, o.id);
    const outstanding = round2((Number(o.orderValue) || 0) - paid);
    if (outstanding <= 0) continue;

    totalOutstanding = round2(totalOutstanding + outstanding);

    if (creditDays !== null) {
      const dueAtMs = o.createdAt.getTime() + creditDays * 86_400_000;
      if (Date.now() > dueAtMs) overdueOrderId = o.id;
    }
  }

  const wouldExceed = creditLimit !== null && totalOutstanding > creditLimit;
  const hold = wouldExceed || overdueOrderId !== null;

  const reasonParts: string[] = [];
  if (wouldExceed) {
    reasonParts.push(
      `Total outstanding ₹${totalOutstanding} hai, jo credit limit ₹${creditLimit} se zyada ho raha hai`
    );
  }
  if (overdueOrderId) {
    reasonParts.push(`Order ${overdueOrderId} ka payment ${creditDays} din ke credit period se overdue hai`);
  }

  return { hold, reason: reasonParts.join(" aur "), outstanding: totalOutstanding };
}

/**
 * Works the Payment_Review gate: no credit extended (both `creditLimit`/`creditDays` null)
 * requires a real advance (`> 0` already recorded) before proceeding; credit extended runs
 * the limit/overdue check and branches to Credit_Hold or straight through to Stock_Check.
 */
export async function workPaymentReview(orderId: string, actorId: string): Promise<OrderRecord> {
  const orgId = await getTenantOrgId();
  const order = await findById(orders, orgId, orderId);
  if (!order) throw new OrderError("Order nahi mila.");
  if (order.status !== "Payment_Review") {
    throw new OrderError(`Ye order "${order.status}" hai, "Payment_Review" nahi.`);
  }
  if (!order.customerId) {
    throw new OrderError("Customer link nahi hai — pehle customer confirm karein.");
  }

  const customer = await findById(customers, orgId, order.customerId);
  if (!customer) throw new OrderError("Customer nahi mila.");

  const creditLimit = customer.creditLimit !== null ? Number(customer.creditLimit) : null;
  const creditDays = customer.creditDays !== null ? customer.creditDays : null;
  const hasCredit = creditLimit !== null || creditDays !== null;

  if (!hasCredit) {
    const totalPaid = await sumPaymentsForOrder(orgId, orderId);
    if (totalPaid <= 0) {
      throw new OrderError(
        "Is customer ko koi credit nahi diya gaya hai — aage badhne se pehle advance payment record karein."
      );
    }
    await updateById(orders, orgId, orderId, { status: "Stock_Check" });
    await logOrderActivity(
      orgId,
      orderId,
      "Status_Change",
      `Advance payment (₹${totalPaid}) mil chuka hai — Stock_Check me aage badha.`,
      actorId
    );
    const updated = await getOrder(orderId);
    if (!updated) throw new OrderError("Order update ho gaya lekin load nahi ho paya.");
    return updated;
  }

  const { hold, reason } = await computeCreditPosition(orgId, customer.id, creditLimit, creditDays);
  if (hold) {
    await updateById(orders, orgId, orderId, { status: "Credit_Hold" });
    await logOrderActivity(orgId, orderId, "Credit_Hold", reason || "Credit check fail ho gaya.", actorId);
  } else {
    await updateById(orders, orgId, orderId, { status: "Stock_Check" });
    await logOrderActivity(
      orgId,
      orderId,
      "Status_Change",
      "Credit check pass ho gaya — Stock_Check me aage badha.",
      actorId
    );
  }

  const updated = await getOrder(orderId);
  if (!updated) throw new OrderError("Order update ho gaya lekin load nahi ho paya.");
  return updated;
}

/**
 * Clears a Credit_Hold — a deliberate human override, so the gate never re-checks itself
 * away. Authorized to the org's configured Credit-Hold Approver (Order Setup) or an Admin
 * (this codebase's standing convention that an Admin can always override an org's own
 * configured single-approver gates — see the FMS full-reset button's role check). Takes the
 * actor's role explicitly rather than re-deriving it, so this stays callable the same way
 * from an API route (which already has the session) and from a live-test script.
 */
export async function approveCreditHold(
  orderId: string,
  actor: { userId: string; role: string }
): Promise<OrderRecord> {
  const orgId = await getTenantOrgId();
  const order = await findById(orders, orgId, orderId);
  if (!order) throw new OrderError("Order nahi mila.");
  if (order.status !== "Credit_Hold") {
    throw new OrderError(`Ye order "${order.status}" hai, "Credit_Hold" nahi.`);
  }

  const setup = await getOrderSetup();
  const authorized =
    actor.role === "Admin" || (Boolean(setup.creditHoldApprover) && actor.userId === setup.creditHoldApprover);
  if (!authorized) {
    throw new OrderError("Sirf configured Credit-Hold Approver (ya Admin) hi ise clear kar sakta hai.");
  }

  await updateById(orders, orgId, orderId, {
    status: "Stock_Check",
    creditApprovedBy: actor.userId,
    creditApprovedAt: new Date(),
  });
  await logOrderActivity(
    orgId,
    orderId,
    "Credit_Approved",
    "Credit Hold clear kiya gaya — Stock_Check me aage badha.",
    actor.userId
  );

  const updated = await getOrder(orderId);
  if (!updated) throw new OrderError("Order update ho gaya lekin load nahi ho paya.");
  return updated;
}

// ---------------------------------------------------------------------------
// Shortfall notification — both channels, best-effort
// ---------------------------------------------------------------------------

interface ShortLine {
  sku: string;
  itemName: string;
  uom: string;
  shortageQty: number;
}

/**
 * Every Active user who holds `key`, Admins implicitly included — the "list users with
 * grant X" helper this module needs and no existing file provides (mirrors the same logic
 * `effectiveModuleAccess()` already encodes for the JWT).
 */
async function listUsersWithGrant(
  key: ModuleAccessKey
): Promise<{ userId: string; fullName: string; phone: string }[]> {
  const all = await listUsers();
  return all
    .filter((u) => u.Status === "Active" && effectiveModuleAccess(u.Role, u.Module_Access).includes(key))
    .map((u) => ({ userId: u.User_ID, fullName: u.Full_Name, phone: u.Phone_Number }));
}

/** A Task + best-effort WhatsApp to every PPC_PLAN holder, then one activity log entry —
 * mirrors src/lib/fms/engine.ts's notifyStepComplete() fan-out pattern exactly: every
 * recipient in parallel, a missing phone or a failed send never blocks anything else. */
async function notifyShortage(
  orgId: string,
  orderId: string,
  order: OrderRow,
  shortLines: ShortLine[]
): Promise<void> {
  const holders = await listUsersWithGrant("PPC_PLAN");
  const skuList = shortLines.map((l) => `${l.itemName} (${l.shortageQty} ${l.uom} kam)`).join(", ");

  if (holders.length === 0) {
    await logOrderActivity(
      orgId,
      orderId,
      "Shortage_Notified",
      `Shortage mila (${skuList}) lekin koi bhi PPC_PLAN holder nahi mila notify karne ke liye.`,
      "SYSTEM"
    );
    return;
  }

  const dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await Promise.all(
    holders.map(async (u) => {
      try {
        await createTask({
          title: `Order ${orderId} — stock shortage`,
          description: `${order.partyName} ke Order ${orderId} ke liye stock kam hai: ${skuList}. Production plan banane ki zaroorat hai.`,
          assignedTo: u.userId,
          assignedBy: "SYSTEM",
          priority: "High",
          dueDate,
          attachmentUrl: "",
          remark: "",
        });
      } catch (error) {
        console.error(`[orders] shortage task creation failed for order ${orderId}, user ${u.userId}:`, error);
      }

      try {
        const result = await sendWhatsAppMessage(
          u.phone,
          `Namaste ${u.fullName}, Order ${orderId} (${order.partyName}) ke liye stock kam hai: ${skuList}. Production plan banane ki zaroorat hai.`
        );
        if (!result.ok) {
          console.error(`[orders] shortage WhatsApp send failed for order ${orderId}, user ${u.userId}: ${result.error}`);
        }
      } catch (error) {
        console.error(`[orders] shortage WhatsApp send threw for order ${orderId}, user ${u.userId}:`, error);
      }
    })
  );

  await logOrderActivity(
    orgId,
    orderId,
    "Shortage_Notified",
    `${holders.length} PPC_PLAN user(s) ko shortage notify kiya gaya: ${skuList}.`,
    "SYSTEM"
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Stock_Check: reserving Free FG stock
// ---------------------------------------------------------------------------

/**
 * Reserves whatever is actually Free against every line of this one order, in a single
 * pass (so two lines of the same SKU on the same order can't both claim the same unit),
 * then moves the order to Dispatch_Pending. Never writes to stock_ledger — a reservation is
 * not a movement, exactly like a production plan's own reservation never touches the ledger
 * until material is actually consumed.
 */
export async function runStockCheck(orderId: string, actorId: string): Promise<OrderRecord> {
  const orgId = await getTenantOrgId();
  const order = await findById(orders, orgId, orderId);
  if (!order) throw new OrderError("Order nahi mila.");
  if (order.status !== "Stock_Check") {
    throw new OrderError(`Ye order "${order.status}" hai, "Stock_Check" nahi.`);
  }

  const itemRows = await db
    .select()
    .from(orderItems)
    .where(and(eq(orderItems.orgId, orgId), eq(orderItems.orderId, orderId)));
  if (itemRows.length === 0) {
    throw new OrderError("Is order me koi item nahi hai.");
  }

  const [ledger, committed, inTransit, reserved] = await Promise.all([
    listLedger(),
    committedBySku(),
    inTransitBySku(),
    orderReservedBySku(),
  ]);
  const onHand = onHandBySku(ledger);

  const used = new Map<string, number>();
  const shortLines: ShortLine[] = [];
  const updates: Promise<unknown>[] = [];

  for (const row of itemRows) {
    const qty = Number(row.qty) || 0;
    const position = positionFor(row.sku, onHand, committed, inTransit, reserved);
    const alreadyUsed = used.get(row.sku) ?? 0;
    const availableNow = round3(Math.max(0, position.free - alreadyUsed));
    const reservedQty = round3(Math.min(qty, availableNow));
    const shortageQty = round3(qty - reservedQty);
    used.set(row.sku, round3(alreadyUsed + reservedQty));

    updates.push(
      db
        .update(orderItems)
        .set({ reservedQty: String(reservedQty), shortageQty: String(shortageQty) })
        .where(
          and(
            eq(orderItems.orgId, orgId),
            eq(orderItems.orderId, orderId),
            eq(orderItems.lineNo, row.lineNo)
          )
        )
    );

    if (shortageQty > 0) {
      shortLines.push({ sku: row.sku, itemName: row.itemName, uom: row.uom, shortageQty });
    }
  }

  await Promise.all(updates);
  await updateById(orders, orgId, orderId, { status: "Dispatch_Pending" });

  const message =
    shortLines.length > 0
      ? `Stock reserve ho gaya — ${shortLines.map((l) => `${l.itemName} (${l.shortageQty} ${l.uom} kam)`).join(", ")}.`
      : "Poora stock reserve ho gaya — koi shortage nahi.";
  await logOrderActivity(orgId, orderId, "Stock_Reserved", message, actorId);

  if (shortLines.length > 0) {
    try {
      await notifyShortage(orgId, orderId, order, shortLines);
    } catch (error) {
      console.error(`[orders] notifyShortage failed for order ${orderId}:`, error);
    }
  }

  const updated = await getOrder(orderId);
  if (!updated) throw new OrderError("Order update ho gaya lekin load nahi ho paya.");
  return updated;
}

// ---------------------------------------------------------------------------
// Step 4 — Dispatch_Pending -> Ready_For_PDI
// ---------------------------------------------------------------------------

export async function commitDispatch(
  orderId: string,
  dispatchCommitDate: string,
  actorId: string
): Promise<OrderRecord> {
  const orgId = await getTenantOrgId();
  const order = await findById(orders, orgId, orderId);
  if (!order) throw new OrderError("Order nahi mila.");
  if (order.status !== "Dispatch_Pending") {
    throw new OrderError(`Ye order "${order.status}" hai, "Dispatch_Pending" nahi.`);
  }
  if (!dispatchCommitDate) {
    throw new OrderError("Dispatch commit date dena zaroori hai.");
  }
  const date = new Date(dispatchCommitDate);
  if (Number.isNaN(date.getTime())) {
    throw new OrderError("Date samajh nahi aayi.");
  }

  await updateById(orders, orgId, orderId, { status: "Ready_For_PDI", dispatchCommitDate: date });
  await logOrderActivity(
    orgId,
    orderId,
    "Dispatch_Committed",
    `Dispatch commit date set ki gayi — ${date.toLocaleDateString("en-IN")}.`,
    actorId
  );

  try {
    await emitFmsEvent("ORDER_READY_FOR_PDI", `ORDERS:${orderId}`);
  } catch (error) {
    console.error(`[orders] emitFmsEvent(ORDER_READY_FOR_PDI) failed for ${orderId}:`, error);
  }

  const updated = await getOrder(orderId);
  if (!updated) throw new OrderError("Order update ho gaya lekin load nahi ho paya.");
  return updated;
}

// ---------------------------------------------------------------------------
// Cancel — from any non-terminal status
// ---------------------------------------------------------------------------

export async function cancelOrder(orderId: string, reason: string, actorId: string): Promise<OrderRecord> {
  const orgId = await getTenantOrgId();
  const order = await findById(orders, orgId, orderId);
  if (!order) throw new OrderError("Order nahi mila.");
  if (TERMINAL_STATUSES.includes(order.status)) {
    throw new OrderError(`Ye order "${order.status}" hai — ab cancel nahi ho sakta.`);
  }

  await updateById(orders, orgId, orderId, { status: "Cancelled" });
  await logOrderActivity(
    orgId,
    orderId,
    "Cancelled",
    `Order cancel kiya gaya.${reason.trim() ? ` (${reason.trim()})` : ""}`,
    actorId
  );

  const updated = await getOrder(orderId);
  if (!updated) throw new OrderError("Order cancel ho gaya lekin load nahi ho paya.");
  return updated;
}
