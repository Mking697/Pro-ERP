import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { and, eq } from "drizzle-orm";
import { customers, leads, quotationItems, quotations } from "@/db/schema";
import { db } from "@/db/client";
import { findById, insertRecord, updateById } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { getSetting } from "@/lib/settings";
import { uploadAttachment } from "@/lib/storage";
import { emitFmsEvent } from "@/lib/fms/engine";
import { createCustomer } from "@/lib/parties/customers";
import { computeTotals, lineAmount, round2, round3 } from "@/lib/leads/quotationMath";
import { logLeadActivity, markOrderConfirmed, markQuotationSent } from "@/lib/leads/leads";
import { getQuotationSetup } from "@/lib/leads/quotationSetup";

/**
 * The document Lead FMS sends before an order exists — see src/db/schema/leads.ts's own
 * header comment for why every party/subject/note/terms field here is a SNAPSHOT taken at
 * creation time, not read live off the lead or off Quotation Setup.
 *
 * Ends at "Order Confirmed": accepting a quotation only flips the lead's status and
 * best-effort emits LEAD_ORDER_CONFIRMED for a future Order module to pick up — see
 * acceptQuotation() below and CLAUDE.md's "Sales chain" notes.
 */

export class QuotationError extends Error {}

export type QuotationStatus = "Draft" | "Sent" | "Accepted" | "Rejected" | "Expired";

export interface QuotationItemRecord {
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

export interface QuotationRecord {
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
  items: QuotationItemRecord[];
}

type QuotationRow = InferSelectModel<typeof quotations>;
type QuotationItemRow = InferSelectModel<typeof quotationItems>;

function rowToItem(row: QuotationItemRow): QuotationItemRecord {
  return {
    lineNo: row.lineNo,
    particular: row.particular,
    specification: row.specification,
    description: row.description,
    uom: row.uom,
    qtyFormula: row.qtyFormula,
    qty: Number(row.qty) || 0,
    rate: Number(row.rate) || 0,
    amount: Number(row.amount) || 0,
  };
}

async function loadItems(orgId: string, quotationId: string): Promise<QuotationItemRecord[]> {
  const rows = await db
    .select()
    .from(quotationItems)
    .where(and(eq(quotationItems.orgId, orgId), eq(quotationItems.quotationId, quotationId)));
  return rows.map(rowToItem).sort((a, b) => Number(a.lineNo) - Number(b.lineNo));
}

function rowToQuotation(row: QuotationRow, items: QuotationItemRecord[]): QuotationRecord {
  return {
    id: row.id,
    quotationNo: row.quotationNo,
    status: row.status,
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
    shippingPartyName: row.shippingPartyName,
    shippingContactPerson: row.shippingContactPerson,
    shippingAddress: row.shippingAddress,
    shippingCity: row.shippingCity,
    shippingState: row.shippingState,
    shippingPincode: row.shippingPincode,
    subject: row.subject,
    note: row.note,
    terms: row.terms,
    subTotal: Number(row.subTotal) || 0,
    freightAmount: Number(row.freightAmount) || 0,
    gstPercent: Number(row.gstPercent) || 0,
    gstAmount: Number(row.gstAmount) || 0,
    payableAmount: Number(row.payableAmount) || 0,
    validUntil: row.validUntil ? row.validUntil.toISOString() : "",
    sentAt: row.sentAt ? row.sentAt.toISOString() : "",
    acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : "",
    attachmentUrl: row.attachmentUrl,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    items,
  };
}

export async function getQuotation(quotationId: string): Promise<QuotationRecord | null> {
  const orgId = await getTenantOrgId();
  const row = await findById(quotations, orgId, quotationId);
  if (!row) return null;
  const items = await loadItems(orgId, quotationId);
  return rowToQuotation(row, items);
}

export async function listQuotationsForLead(leadId: string): Promise<QuotationRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select()
    .from(quotations)
    .where(and(eq(quotations.orgId, orgId), eq(quotations.leadId, leadId)));
  const result: QuotationRecord[] = [];
  for (const row of rows) {
    result.push(rowToQuotation(row, await loadItems(orgId, row.id)));
  }
  return result.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * REF-numbering, adapted from a reference CRM's withQuoteNumber: read the highest number
 * already used for this org's own prefix, add one. `quotations` carries a real
 * `(org_id, quotation_no)` unique constraint (added after this module's first pass flagged
 * the gap), so createQuotation() below retries this on a genuine collision rather than
 * trusting a single fresh read to never race — the same safety net the reference's own
 * allocator relies on.
 */
async function allocateQuotationNumber(orgId: string, prefix: string, start: number): Promise<string> {
  const existing = await db
    .select({ quotationNo: quotations.quotationNo })
    .from(quotations)
    .where(eq(quotations.orgId, orgId));

  const pattern = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`);
  let maxNumber = 0;
  for (const row of existing) {
    const match = pattern.exec(row.quotationNo);
    if (match) maxNumber = Math.max(maxNumber, Number(match[1]));
  }

  const next = Math.max(maxNumber + 1, start);
  return `${prefix}-${String(next).padStart(4, "0")}`;
}

/** True for a Postgres unique-violation (23505) against the given constraint name. */
function isUniqueViolation(error: unknown, constraintName: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: unknown; constraint?: unknown; message?: unknown };
  if (e.code !== "23505") return false;
  if (typeof e.constraint === "string") return e.constraint === constraintName;
  return typeof e.message === "string" && e.message.includes(constraintName);
}

interface QuotationSeed {
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
}

/**
 * The one place a `quotations` row actually gets inserted — used by both a lead's own
 * Quotation and a walk-in one, so both agree on numbering, retry-on-collision, and
 * Quotation Setup's defaults. See `allocateQuotationNumber`'s own comment for why the retry
 * loop exists (a real `(org_id, quotation_no)` unique constraint, not just a fresh read).
 */
async function insertQuotationRow(
  orgId: string,
  seed: QuotationSeed,
  createdBy: string
): Promise<QuotationRecord> {
  const setup = await getQuotationSetup();
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + setup.validityDays);

  const CONSTRAINT = "quotations_org_id_quotation_no_unique";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const quotationNo = await allocateQuotationNumber(orgId, setup.numberPrefix, setup.numberStart);
    try {
      const row = await insertRecord(quotations, {
        id: generateId("QUO"),
        orgId,
        quotationNo,
        status: "Draft",
        leadId: seed.leadId,
        partyName: seed.partyName,
        contactPerson: seed.contactPerson,
        customerMobile: seed.customerMobile,
        customerEmail: seed.customerEmail,
        customerGst: seed.customerGst,
        billingAddress: seed.billingAddress,
        billingCity: seed.billingCity,
        billingState: seed.billingState,
        billingPincode: seed.billingPincode,
        subject: setup.defaultSubject,
        note: setup.defaultNote,
        terms: setup.defaultTerms,
        gstPercent: String(setup.gstPercent),
        validUntil,
        createdBy,
      });

      if (seed.leadId) {
        await logLeadActivity(orgId, seed.leadId, "Quotation", `Quotation ${quotationNo} shuru kiya gaya.`, createdBy);
      }

      return rowToQuotation(row, []);
    } catch (error) {
      if (!isUniqueViolation(error, CONSTRAINT)) throw error;
      // Two quotations allocated the same number in the same instant — re-read the true
      // max (now including the row that just won the race) and try again.
    }
  }
  throw new QuotationError("Quotation number allocate nahi ho paya. Dobara try karein.");
}

/** Negotiation -> a new Draft quotation, seeded from the lead and from Quotation Setup's
 * own defaults. */
export async function createQuotation(leadId: string, createdBy: string): Promise<QuotationRecord> {
  const orgId = await getTenantOrgId();
  const leadRow = await findById(leads, orgId, leadId);
  if (!leadRow) throw new QuotationError("Lead nahi mila.");
  if (leadRow.status !== "Negotiation") {
    throw new QuotationError(
      `Ye lead "${leadRow.status}" hai — Quotation sirf Negotiation stage se banti hai.`
    );
  }

  return insertQuotationRow(
    orgId,
    {
      leadId,
      partyName: leadRow.companyName || leadRow.personName,
      contactPerson: leadRow.personName,
      customerMobile: leadRow.phone,
      customerEmail: leadRow.email,
      customerGst: "",
      billingAddress: "",
      billingCity: leadRow.city,
      billingState: leadRow.state,
      billingPincode: "",
    },
    createdBy
  );
}

export interface NewWalkInCustomerInput {
  customerName: string;
  phone?: string;
  email?: string;
  gstin?: string;
  billingAddress?: string;
  city?: string;
  state?: string;
}

export interface CreateWalkInQuotationInput {
  /** An existing row from this salesperson's own Customer Master. */
  customerId?: string;
  /** Or a brand-new customer, added to the master (createdBy = this salesperson) on the
   *  spot and then quoted immediately. */
  newCustomer?: NewWalkInCustomerInput;
}

/**
 * A quotation with no lead behind it — e.g. a repeat customer who calls in directly rather
 * than arriving through the pipeline. Picks up Pro-ERP's existing Customer Master
 * (`src/lib/parties/customers.ts`, Module 13) rather than inventing a second customer
 * concept: "Existing Customer" reads from it, "New Customer" writes to it (tagged
 * `createdBy` = whoever is quoting, same as every other master record) before quoting.
 */
export async function createWalkInQuotation(
  input: CreateWalkInQuotationInput,
  createdBy: string
): Promise<QuotationRecord> {
  const orgId = await getTenantOrgId();

  let customerId = input.customerId ?? "";
  let customerName: string;
  let phone: string;
  let email: string;
  let gstin: string;
  let billingAddress: string;
  let city: string;
  let state: string;

  if (customerId) {
    const row = await findById(customers, orgId, customerId);
    if (!row) throw new QuotationError("Customer nahi mila.");
    customerName = row.customerName;
    phone = row.phone;
    email = row.email;
    gstin = row.gstin;
    billingAddress = row.billingAddress;
    city = row.city;
    state = row.state;
  } else if (input.newCustomer?.customerName?.trim()) {
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
    customerId = customer.Customer_ID;
    customerName = customer.Customer_Name;
    phone = customer.Phone;
    email = customer.Email;
    gstin = customer.GSTIN;
    billingAddress = customer.Billing_Address;
    city = customer.City;
    state = customer.State;
  } else {
    throw new QuotationError("Ek Customer chunein ya naya Customer ka naam bharein.");
  }

  return insertQuotationRow(
    orgId,
    {
      leadId: "",
      partyName: customerName,
      contactPerson: customerName,
      customerMobile: phone,
      customerEmail: email,
      customerGst: gstin,
      billingAddress,
      billingCity: city,
      billingState: state,
      billingPincode: "",
    },
    createdBy
  );
}

/** Every quotation for the org — lead-linked and walk-in alike. */
export async function listAllQuotations(): Promise<QuotationRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await db.select().from(quotations).where(eq(quotations.orgId, orgId));
  const result: QuotationRecord[] = [];
  for (const row of rows) {
    result.push(rowToQuotation(row, await loadItems(orgId, row.id)));
  }
  return result.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function assertEditable(status: QuotationStatus): void {
  if (status === "Accepted") {
    throw new QuotationError("Is quotation se order confirm ho chuka hai — ab ye edit nahi ho sakta.");
  }
}

export interface QuotationHeaderInput {
  partyName?: string;
  contactPerson?: string;
  customerMobile?: string;
  customerEmail?: string;
  customerGst?: string;
  billingAddress?: string;
  billingCity?: string;
  billingState?: string;
  billingPincode?: string;
  shippingPartyName?: string;
  shippingContactPerson?: string;
  shippingAddress?: string;
  shippingCity?: string;
  shippingState?: string;
  shippingPincode?: string;
  subject?: string;
  note?: string;
  terms?: string;
  /** ISO date string, or "" to clear it. */
  validUntil?: string;
}

export async function saveQuotationHeader(
  quotationId: string,
  input: QuotationHeaderInput
): Promise<QuotationRecord> {
  const orgId = await getTenantOrgId();
  const existing = await findById(quotations, orgId, quotationId);
  if (!existing) throw new QuotationError("Quotation nahi mila.");
  assertEditable(existing.status);

  const patch: Partial<InferInsertModel<typeof quotations>> = {};
  if (input.partyName !== undefined) {
    if (!input.partyName.trim()) throw new QuotationError("Party Name zaroori hai.");
    patch.partyName = input.partyName.trim();
  }
  if (input.contactPerson !== undefined) patch.contactPerson = input.contactPerson.trim();
  if (input.customerMobile !== undefined) patch.customerMobile = input.customerMobile.trim();
  if (input.customerEmail !== undefined) patch.customerEmail = input.customerEmail.trim();
  if (input.customerGst !== undefined) patch.customerGst = input.customerGst.trim();
  if (input.billingAddress !== undefined) patch.billingAddress = input.billingAddress.trim();
  if (input.billingCity !== undefined) patch.billingCity = input.billingCity.trim();
  if (input.billingState !== undefined) patch.billingState = input.billingState.trim();
  if (input.billingPincode !== undefined) patch.billingPincode = input.billingPincode.trim();
  if (input.shippingPartyName !== undefined) patch.shippingPartyName = input.shippingPartyName.trim();
  if (input.shippingContactPerson !== undefined) {
    patch.shippingContactPerson = input.shippingContactPerson.trim();
  }
  if (input.shippingAddress !== undefined) patch.shippingAddress = input.shippingAddress.trim();
  if (input.shippingCity !== undefined) patch.shippingCity = input.shippingCity.trim();
  if (input.shippingState !== undefined) patch.shippingState = input.shippingState.trim();
  if (input.shippingPincode !== undefined) patch.shippingPincode = input.shippingPincode.trim();
  if (input.subject !== undefined) patch.subject = input.subject;
  if (input.note !== undefined) patch.note = input.note;
  if (input.terms !== undefined) patch.terms = input.terms;
  if (input.validUntil !== undefined) {
    patch.validUntil = input.validUntil ? new Date(input.validUntil) : null;
  }

  if (Object.keys(patch).length > 0) {
    await updateById(quotations, orgId, quotationId, patch);
  }

  const updated = await getQuotation(quotationId);
  if (!updated) throw new QuotationError("Quotation update ho gaya lekin load nahi ho paya.");
  return updated;
}

export interface QuotationItemInput {
  particular?: string;
  specification?: string;
  description?: string;
  uom?: string;
  /** The expression this line's qty was worked out from, or "" for a plain-typed number. */
  qtyFormula?: string;
  qty: number;
  rate: number;
}

/**
 * Replaces the whole grid in one go — a quotation grid is edited as a unit on the client,
 * so saving row by row would let a half-applied save leave a document nobody actually
 * typed. `db.batch()` is this driver's real atomicity primitive (neon-http has no
 * interactive transactions — see src/db/client.ts and src/lib/platform/registry.ts's
 * deleteOrganization for the same pattern): delete + insert + the recomputed-totals update
 * all ride one HTTP round trip, so the totals can never drift from the rows they came from.
 */
export async function saveQuotationItems(
  quotationId: string,
  rows: QuotationItemInput[],
  money: { freightAmount: number; gstPercent: number }
): Promise<QuotationRecord> {
  const orgId = await getTenantOrgId();
  const existing = await findById(quotations, orgId, quotationId);
  if (!existing) throw new QuotationError("Quotation nahi mila.");
  assertEditable(existing.status);

  if (rows.length > 200) {
    throw new QuotationError("Ek quotation me zyada se zyada 200 lines ho sakti hain.");
  }

  const priced = rows
    .filter(
      (row) =>
        (row.particular ?? "").trim() ||
        (row.description ?? "").trim() ||
        row.qty ||
        row.rate
    )
    .map((row, index) => {
      const qty = round3(Math.max(0, row.qty || 0));
      const rate = round2(Math.max(0, row.rate || 0));
      return {
        lineNo: String(index + 1),
        particular: row.particular?.trim() ?? "",
        specification: row.specification?.trim() ?? "",
        description: row.description?.trim() ?? "",
        uom: row.uom?.trim() ?? "",
        qtyFormula: row.qtyFormula?.trim() ?? "",
        qty,
        rate,
        amount: lineAmount(qty, rate),
      };
    });

  const totals = computeTotals(priced, money.freightAmount, money.gstPercent);

  const insertRows = priced.map((p) => ({
    quotationId,
    orgId,
    lineNo: p.lineNo,
    particular: p.particular,
    specification: p.specification,
    description: p.description,
    uom: p.uom,
    qtyFormula: p.qtyFormula,
    qty: String(p.qty),
    rate: String(p.rate),
    amount: String(p.amount),
  }));

  const deleteStmt = db
    .delete(quotationItems)
    .where(and(eq(quotationItems.orgId, orgId), eq(quotationItems.quotationId, quotationId)));
  const updateStmt = db
    .update(quotations)
    .set({
      subTotal: String(totals.subTotal),
      freightAmount: String(totals.freight),
      gstPercent: String(totals.gstPercent),
      gstAmount: String(totals.gst),
      payableAmount: String(totals.payable),
    })
    .where(and(eq(quotations.orgId, orgId), eq(quotations.id, quotationId)));

  if (insertRows.length > 0) {
    await db.batch([deleteStmt, db.insert(quotationItems).values(insertRows), updateStmt]);
  } else {
    await db.batch([deleteStmt, updateStmt]);
  }

  const updated = await getQuotation(quotationId);
  if (!updated) throw new QuotationError("Quotation update ho gaya lekin load nahi ho paya.");
  return updated;
}

export async function sendQuotation(quotationId: string, actorId: string): Promise<QuotationRecord> {
  const orgId = await getTenantOrgId();
  const existing = await findById(quotations, orgId, quotationId);
  if (!existing) throw new QuotationError("Quotation nahi mila.");
  if (existing.status !== "Draft") {
    throw new QuotationError(`Ye quotation "${existing.status}" hai, "Draft" nahi.`);
  }
  const items = await loadItems(orgId, quotationId);
  if (items.length === 0) {
    throw new QuotationError("Bhejne se pehle kam se kam ek line add karein.");
  }

  await updateById(quotations, orgId, quotationId, { status: "Sent", sentAt: new Date() });

  if (existing.leadId) {
    await markQuotationSent(existing.leadId, actorId, existing.quotationNo);
  }

  const updated = await getQuotation(quotationId);
  if (!updated) throw new QuotationError("Quotation update ho gaya lekin load nahi ho paya.");
  return updated;
}

export async function rejectQuotation(
  quotationId: string,
  actorId: string,
  reason?: string
): Promise<QuotationRecord> {
  const orgId = await getTenantOrgId();
  const existing = await findById(quotations, orgId, quotationId);
  if (!existing) throw new QuotationError("Quotation nahi mila.");
  if (existing.status === "Accepted") {
    throw new QuotationError("Accepted quotation reject nahi ho sakta.");
  }

  await updateById(quotations, orgId, quotationId, { status: "Rejected" });

  if (existing.leadId) {
    await logLeadActivity(
      orgId,
      existing.leadId,
      "Quotation",
      `Quotation ${existing.quotationNo} reject ho gaya.${reason ? ` (${reason})` : ""}`,
      actorId
    );
  }

  const updated = await getQuotation(quotationId);
  if (!updated) throw new QuotationError("Quotation update ho gaya lekin load nahi ho paya.");
  return updated;
}

/**
 * Sent -> Accepted (terminal, the hand-off point). Flips the linked lead to
 * Order_Confirmed and best-effort emits LEAD_ORDER_CONFIRMED — wrapped in try/catch, must
 * never undo or block the accept write that already succeeded, the same convention every
 * other emitFmsEvent() call site (INDENT_APPROVED, INWARD_ENTRY_CREATED) already follows.
 * Deliberately stops here — no Order/Company/Contact record is created; that is the future
 * Order module's own job, picking up from this event.
 */
export async function acceptQuotation(quotationId: string, actorId: string): Promise<QuotationRecord> {
  const orgId = await getTenantOrgId();
  const existing = await findById(quotations, orgId, quotationId);
  if (!existing) throw new QuotationError("Quotation nahi mila.");
  if (existing.status === "Accepted") {
    const already = await getQuotation(quotationId);
    if (!already) throw new QuotationError("Quotation load nahi ho paya.");
    return already;
  }
  if (existing.status !== "Sent") {
    throw new QuotationError(`Ye quotation "${existing.status}" hai — Accept sirf "Sent" quotation par hota hai.`);
  }

  await updateById(quotations, orgId, quotationId, { status: "Accepted", acceptedAt: new Date() });

  if (existing.leadId) {
    await markOrderConfirmed(existing.leadId, actorId, existing.quotationNo);

    try {
      await emitFmsEvent("LEAD_ORDER_CONFIRMED", `LEADS:${existing.leadId}`);
    } catch (error) {
      console.error(`[leads] emitFmsEvent(LEAD_ORDER_CONFIRMED) failed for ${existing.leadId}:`, error);
    }
  }

  const updated = await getQuotation(quotationId);
  if (!updated) throw new QuotationError("Quotation update ho gaya lekin load nahi ho paya.");
  return updated;
}

/**
 * Renders the quotation PDF, uploads it to Blob, and stores the URL on the quotation's
 * own attachmentUrl — callers (the download route, and Send) just read `.url` back.
 *
 * `quotationPdf.tsx` (and the @react-pdf/renderer tree behind it) is imported dynamically,
 * here alone, rather than statically at this file's top — every other export in this file
 * (createQuotation, saveQuotationItems, sendQuotation, acceptQuotation, ...) has nothing to
 * do with PDF rendering, so a route or script that never calls this one function should
 * never have to resolve that dependency tree at all.
 */
export async function renderQuotationPdf(quotationId: string): Promise<{ url: string }> {
  const quotation = await getQuotation(quotationId);
  if (!quotation) throw new QuotationError("Quotation nahi mila.");
  if (quotation.items.length === 0) {
    throw new QuotationError("PDF banane se pehle kam se kam ek line add karein.");
  }

  const setup = await getQuotationSetup();
  const logoUrl = (await getSetting("ORG_LOGO_URL")) ?? "";

  const dateText = new Date(quotation.createdAt).toLocaleDateString("en-IN");
  const validText = quotation.validUntil
    ? new Date(quotation.validUntil).toLocaleDateString("en-IN")
    : null;

  const { renderQuotationPdfBuffer } = await import("@/lib/leads/quotationPdf");
  const buffer = await renderQuotationPdfBuffer(quotation, setup, logoUrl, dateText, validText);

  const { url } = await uploadAttachment({
    fileName: `Quotation_${quotation.quotationNo}.pdf`,
    mimeType: "application/pdf",
    buffer,
  });

  const orgId = await getTenantOrgId();
  await updateById(quotations, orgId, quotationId, { attachmentUrl: url });

  return { url };
}
