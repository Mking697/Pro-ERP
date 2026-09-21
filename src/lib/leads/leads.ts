import type { InferSelectModel } from "drizzle-orm";
import { and, desc, eq } from "drizzle-orm";
import { leadActivities, leads } from "@/db/schema";
import { db } from "@/db/client";
import { findById, insertRecord, listByOrg, updateById } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";

/**
 * Lead FMS — lead capture through the pipeline (Qualify -> Follow-up -> Meeting ->
 * Negotiation), up to but not including the Quotation itself (src/lib/leads/quotations.ts).
 * Built as its own hardcoded flow, not a generic FMS Template, matching Purchase FMS's
 * precedent — see CLAUDE.md.
 *
 * Every transition here writes the lead's new status/fields AND appends a leadActivities
 * row in the same call, mirroring how leave_reassignments keeps a full audit trail: a lead
 * is read by a salesperson as "what happened to this lead," not as a single status cell.
 */

export class LeadError extends Error {}

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

export type LeadActivityKind =
  | "Note"
  | "Status_Change"
  | "Follow_Up"
  | "Meeting"
  | "Negotiation"
  | "Quotation"
  | "Won"
  | "Lost";

const TERMINAL_STATUSES: readonly LeadStatus[] = ["Junk", "Order_Confirmed", "Lost"];

export interface LeadRecord {
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

export interface LeadActivityRecord {
  id: string;
  leadId: string;
  kind: LeadActivityKind;
  message: string;
  actorId: string;
  createdAt: string;
}

type LeadRow = InferSelectModel<typeof leads>;
type LeadActivityRow = InferSelectModel<typeof leadActivities>;

function rowToLead(row: LeadRow): LeadRecord {
  return {
    id: row.id,
    personName: row.personName,
    phone: row.phone,
    email: row.email,
    companyName: row.companyName,
    city: row.city,
    state: row.state,
    source: row.source,
    productInterest: row.productInterest,
    message: row.message,
    status: row.status,
    assignedTo: row.assignedTo,
    nextFollowUpAt: row.nextFollowUpAt ? row.nextFollowUpAt.toISOString() : "",
    meetingAt: row.meetingAt ? row.meetingAt.toISOString() : "",
    meetingMode: row.meetingMode,
    lostReason: row.lostReason,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function rowToActivity(row: LeadActivityRow): LeadActivityRecord {
  return {
    id: row.id,
    leadId: row.leadId,
    kind: row.kind,
    message: row.message,
    actorId: row.actorId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listLeads(status?: LeadStatus): Promise<LeadRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = status
    ? await db.select().from(leads).where(and(eq(leads.orgId, orgId), eq(leads.status, status)))
    : await listByOrg(leads, orgId);
  return rows.map(rowToLead).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function listLeadActivities(leadId: string): Promise<LeadActivityRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select()
    .from(leadActivities)
    .where(and(eq(leadActivities.orgId, orgId), eq(leadActivities.leadId, leadId)))
    .orderBy(desc(leadActivities.createdAt));
  return rows.map(rowToActivity);
}

export interface LeadDetail {
  lead: LeadRecord;
  activities: LeadActivityRecord[];
}

export async function getLead(leadId: string): Promise<LeadDetail | null> {
  const orgId = await getTenantOrgId();
  const row = await findById(leads, orgId, leadId);
  if (!row) return null;
  const activities = await listLeadActivities(leadId);
  return { lead: rowToLead(row), activities };
}

/** Exported so quotations.ts (a quotation is logged onto its lead's own timeline too) can
 * append to the same audit trail without reaching into leads' row shape directly. */
export async function logLeadActivity(
  orgId: string,
  leadId: string,
  kind: LeadActivityKind,
  message: string,
  actorId: string
): Promise<void> {
  await insertRecord(leadActivities, {
    id: generateId("LAC"),
    orgId,
    leadId,
    kind,
    message,
    actorId,
  });
}

/** The optional fields shared by a manual "+ Add" and one row of a bulk import. */
export interface LeadFields {
  phone?: string;
  email?: string;
  companyName?: string;
  city?: string;
  state?: string;
  source?: string;
  productInterest?: string;
  message?: string;
  assignedTo?: string;
}

export interface CreateLeadInput extends LeadFields {
  personName: string;
  createdBy: string;
}

/** Case/space-insensitive match on name, and on phone when both rows have one — never
 * blocks the save, only flags it, same convention as Vendor/Customer/Item bulk import. */
function duplicateWarning(
  personName: string,
  phone: string,
  existing: { personName: string; phone: string }[]
): string | null {
  const name = personName.trim().toLowerCase();
  const ph = phone.trim();
  const hit = existing.some(
    (e) => e.personName.trim().toLowerCase() === name && (!ph || e.phone.trim() === ph)
  );
  return hit ? `"${personName.trim()}" (${ph || "no phone"}) jaisa lead pehle se hai.` : null;
}

async function insertLead(
  orgId: string,
  personName: string,
  fields: LeadFields,
  createdBy: string
): Promise<LeadRecord> {
  const row = await insertRecord(leads, {
    id: generateId("LED"),
    orgId,
    personName: personName.trim(),
    phone: fields.phone?.trim() ?? "",
    email: fields.email?.trim() ?? "",
    companyName: fields.companyName?.trim() ?? "",
    city: fields.city?.trim() ?? "",
    state: fields.state?.trim() ?? "",
    source: fields.source?.trim() || "Manual",
    productInterest: fields.productInterest?.trim() ?? "",
    message: fields.message?.trim() ?? "",
    assignedTo: fields.assignedTo?.trim() ?? "",
    status: "New",
    createdBy,
  });
  await logLeadActivity(orgId, row.id, "Note", `Lead punch kiya gaya (source: ${row.source}).`, createdBy);
  return rowToLead(row);
}

export interface CreateLeadResult {
  lead: LeadRecord;
  warning: string | null;
}

export async function createLead(input: CreateLeadInput): Promise<CreateLeadResult> {
  if (!input.personName.trim()) {
    throw new LeadError("Naam zaroori hai.");
  }
  const orgId = await getTenantOrgId();
  const existing = await listByOrg(leads, orgId);
  const warning = duplicateWarning(
    input.personName,
    input.phone ?? "",
    existing.map((l) => ({ personName: l.personName, phone: l.phone }))
  );
  const lead = await insertLead(orgId, input.personName, input, input.createdBy);
  return { lead, warning };
}

export interface BulkCreateLeadRowInput extends LeadFields {
  /** 1-based row number in the uploaded file (header row is 1), only for error messages. */
  row: number;
  personName: string;
}

export interface BulkCreateLeadResult {
  created: { row: number; lead: LeadRecord }[];
  errors: { row: number; message: string }[];
  warnings: { row: number; message: string }[];
}

/** Mirrors createVendorsBulk()/createCustomersBulk() — each row is its own insert (no
 * bulk-insert primitive in repo.ts), duplicates warn but never block. */
export async function createLeadsBulk(
  inputs: BulkCreateLeadRowInput[],
  createdBy: string
): Promise<BulkCreateLeadResult> {
  const created: { row: number; lead: LeadRecord }[] = [];
  const errors: { row: number; message: string }[] = [];
  const warnings: { row: number; message: string }[] = [];

  const orgId = await getTenantOrgId();
  const seen = (await listByOrg(leads, orgId)).map((l) => ({ personName: l.personName, phone: l.phone }));

  for (const input of inputs) {
    if (!input.personName.trim()) {
      errors.push({ row: input.row, message: "Naam zaroori hai." });
      continue;
    }

    const warning = duplicateWarning(input.personName, input.phone ?? "", seen);
    if (warning) warnings.push({ row: input.row, message: warning });

    const lead = await insertLead(
      orgId,
      input.personName,
      { ...input, source: input.source || "Bulk_Import" },
      createdBy
    );
    created.push({ row: input.row, lead });
    seen.push({ personName: lead.personName, phone: lead.phone });
  }

  return { created, errors, warnings };
}

function assertNotTerminal(status: LeadStatus): void {
  if (TERMINAL_STATUSES.includes(status)) {
    throw new LeadError(`Ye lead "${status}" hai — ab isme koi action nahi ho sakta.`);
  }
}

/** New -> Qualified, or New -> Junk (terminal). */
export async function qualifyLead(
  leadId: string,
  actorId: string,
  decision: "Qualified" | "Junk",
  note?: string
): Promise<LeadRecord> {
  const orgId = await getTenantOrgId();
  const row = await findById(leads, orgId, leadId);
  if (!row) throw new LeadError("Lead nahi mila.");
  if (row.status !== "New") {
    throw new LeadError(`Ye lead "${row.status}" hai, "New" nahi — Qualify sirf New lead par chalta hai.`);
  }

  const updated = await updateById(leads, orgId, leadId, { status: decision });
  if (!updated) throw new LeadError("Lead update nahi ho paya.");

  await logLeadActivity(
    orgId,
    leadId,
    "Status_Change",
    decision === "Qualified"
      ? `Lead Qualify kiya gaya.${note ? ` (${note})` : ""}`
      : `Lead Junk kiya gaya.${note ? ` Reason: ${note}` : ""}`,
    actorId
  );

  return rowToLead(updated);
}

export type FollowUpOutcome = "Interested" | "Not_Interested" | "Call_Back_Later";

/**
 * Follow_Up loops on "Call_Back_Later" (sets a future nextFollowUpAt and stays put).
 * "Not_Interested" ends the lead as Lost right here rather than making the caller take a
 * second step. "Interested" just logs the interest — Meeting_Scheduled is a separate,
 * explicit action (scheduleMeeting) so the actual date/mode gets captured.
 */
export async function logFollowUp(
  leadId: string,
  actorId: string,
  outcome: FollowUpOutcome,
  opts: { nextFollowUpAt?: Date; note?: string } = {}
): Promise<LeadRecord> {
  const orgId = await getTenantOrgId();
  const row = await findById(leads, orgId, leadId);
  if (!row) throw new LeadError("Lead nahi mila.");
  assertNotTerminal(row.status);
  if (row.status !== "Qualified" && row.status !== "Follow_Up") {
    throw new LeadError(
      `Ye lead "${row.status}" hai — Follow-up sirf Qualified ya Follow_Up stage me hota hai.`
    );
  }

  if (outcome === "Call_Back_Later") {
    if (!opts.nextFollowUpAt) throw new LeadError("Agli follow-up date/time dena zaroori hai.");
    const updated = await updateById(leads, orgId, leadId, {
      status: "Follow_Up",
      nextFollowUpAt: opts.nextFollowUpAt,
    });
    if (!updated) throw new LeadError("Lead update nahi ho paya.");
    await logLeadActivity(
      orgId,
      leadId,
      "Follow_Up",
      `Call Back Later — agli follow-up ${opts.nextFollowUpAt.toLocaleString("en-IN")} ko.${
        opts.note ? ` (${opts.note})` : ""
      }`,
      actorId
    );
    return rowToLead(updated);
  }

  if (outcome === "Not_Interested") {
    const updated = await updateById(leads, orgId, leadId, {
      status: "Lost",
      lostReason: opts.note?.trim() || "Follow-up: Not Interested",
      nextFollowUpAt: null,
    });
    if (!updated) throw new LeadError("Lead update nahi ho paya.");
    await logLeadActivity(orgId, leadId, "Lost", "Follow-up me Not Interested — lead Lost mark kiya gaya.", actorId);
    return rowToLead(updated);
  }

  // Interested — stays in Follow_Up, ready for Schedule Meeting next.
  const updated = await updateById(leads, orgId, leadId, {
    status: "Follow_Up",
    nextFollowUpAt: null,
  });
  if (!updated) throw new LeadError("Lead update nahi ho paya.");
  await logLeadActivity(
    orgId,
    leadId,
    "Follow_Up",
    `Follow-up me Interested mila.${opts.note ? ` (${opts.note})` : ""}`,
    actorId
  );
  return rowToLead(updated);
}

/** Qualified/Follow_Up -> Meeting_Scheduled (also reusable to reschedule while already in
 * Meeting_Scheduled, though logMeetingOutcome's own "Reschedule" outcome is the normal path
 * for that). */
export async function scheduleMeeting(
  leadId: string,
  actorId: string,
  meetingAt: Date,
  meetingMode: string
): Promise<LeadRecord> {
  const orgId = await getTenantOrgId();
  const row = await findById(leads, orgId, leadId);
  if (!row) throw new LeadError("Lead nahi mila.");
  assertNotTerminal(row.status);
  if (row.status !== "Qualified" && row.status !== "Follow_Up" && row.status !== "Meeting_Scheduled") {
    throw new LeadError(`Ye lead "${row.status}" hai — Meeting sirf Follow-up ke baad schedule ho sakti hai.`);
  }

  const updated = await updateById(leads, orgId, leadId, {
    status: "Meeting_Scheduled",
    meetingAt,
    meetingMode: meetingMode.trim(),
    nextFollowUpAt: null,
  });
  if (!updated) throw new LeadError("Lead update nahi ho paya.");
  await logLeadActivity(
    orgId,
    leadId,
    "Meeting",
    `Meeting schedule ki gayi — ${meetingAt.toLocaleString("en-IN")}${meetingMode ? ` (${meetingMode})` : ""}.`,
    actorId
  );
  return rowToLead(updated);
}

export type MeetingOutcome = "Done" | "Reschedule" | "Not_Interested";

/** Meeting_Scheduled loops on "Reschedule". "Done" moves the lead into Negotiation.
 * "Not_Interested" ends it as Lost. */
export async function logMeetingOutcome(
  leadId: string,
  actorId: string,
  outcome: MeetingOutcome,
  opts: { rescheduleAt?: Date; note?: string } = {}
): Promise<LeadRecord> {
  const orgId = await getTenantOrgId();
  const row = await findById(leads, orgId, leadId);
  if (!row) throw new LeadError("Lead nahi mila.");
  if (row.status !== "Meeting_Scheduled") {
    throw new LeadError(`Ye lead "${row.status}" hai, "Meeting_Scheduled" nahi.`);
  }

  if (outcome === "Reschedule") {
    if (!opts.rescheduleAt) throw new LeadError("Nayi meeting date/time dena zaroori hai.");
    const updated = await updateById(leads, orgId, leadId, { meetingAt: opts.rescheduleAt });
    if (!updated) throw new LeadError("Lead update nahi ho paya.");
    await logLeadActivity(
      orgId,
      leadId,
      "Meeting",
      `Meeting reschedule ki gayi — ${opts.rescheduleAt.toLocaleString("en-IN")}.${
        opts.note ? ` (${opts.note})` : ""
      }`,
      actorId
    );
    return rowToLead(updated);
  }

  if (outcome === "Not_Interested") {
    const updated = await updateById(leads, orgId, leadId, {
      status: "Lost",
      lostReason: opts.note?.trim() || "Meeting: Not Interested",
    });
    if (!updated) throw new LeadError("Lead update nahi ho paya.");
    await logLeadActivity(orgId, leadId, "Lost", "Meeting me Not Interested — lead Lost mark kiya gaya.", actorId);
    return rowToLead(updated);
  }

  // Done — meeting held, ready to negotiate.
  const updated = await updateById(leads, orgId, leadId, { status: "Negotiation" });
  if (!updated) throw new LeadError("Lead update nahi ho paya.");
  await logLeadActivity(orgId, leadId, "Meeting", `Meeting ho gayi.${opts.note ? ` (${opts.note})` : ""}`, actorId);
  return rowToLead(updated);
}

/**
 * Requirement notes at the Negotiation stage — repeatable (a lead can be negotiated more
 * than once before a quotation goes out). Tolerant of being called straight from
 * Meeting_Scheduled as well as from Negotiation itself, since both are the same real-world
 * moment from the Doer's chair; either way the lead ends up (or stays) in Negotiation.
 */
export async function saveNegotiation(leadId: string, actorId: string, notes: string): Promise<LeadRecord> {
  if (!notes.trim()) throw new LeadError("Requirement notes likhna zaroori hai.");

  const orgId = await getTenantOrgId();
  const row = await findById(leads, orgId, leadId);
  if (!row) throw new LeadError("Lead nahi mila.");
  if (row.status !== "Meeting_Scheduled" && row.status !== "Negotiation") {
    throw new LeadError(`Ye lead "${row.status}" hai — Negotiation sirf Meeting ke baad hoti hai.`);
  }

  const updated = await updateById(leads, orgId, leadId, { status: "Negotiation" });
  if (!updated) throw new LeadError("Lead update nahi ho paya.");
  await logLeadActivity(orgId, leadId, "Negotiation", notes.trim(), actorId);
  return rowToLead(updated);
}

/** From any non-terminal status. */
export async function markLost(leadId: string, actorId: string, reason: string): Promise<LeadRecord> {
  if (!reason.trim()) throw new LeadError("Lost reason dena zaroori hai.");

  const orgId = await getTenantOrgId();
  const row = await findById(leads, orgId, leadId);
  if (!row) throw new LeadError("Lead nahi mila.");
  assertNotTerminal(row.status);

  const updated = await updateById(leads, orgId, leadId, {
    status: "Lost",
    lostReason: reason.trim(),
  });
  if (!updated) throw new LeadError("Lead update nahi ho paya.");
  await logLeadActivity(orgId, leadId, "Lost", `Lead Lost mark kiya gaya — ${reason.trim()}.`, actorId);
  return rowToLead(updated);
}

/** Called by quotations.ts's sendQuotation() — kept here so both files agree on exactly
 * what the lead-side half of "a quotation went out" looks like. */
export async function markQuotationSent(leadId: string, actorId: string, quotationNo: string): Promise<void> {
  const orgId = await getTenantOrgId();
  const updated = await updateById(leads, orgId, leadId, { status: "Quotation_Sent" });
  if (!updated) throw new LeadError("Lead nahi mila.");
  await logLeadActivity(orgId, leadId, "Quotation", `Quotation ${quotationNo} bheja gaya.`, actorId);
}

/** Called by quotations.ts's acceptQuotation() — the seam this module hands off to a
 * future Order module at (see this module's own header comment and CLAUDE.md). */
export async function markOrderConfirmed(leadId: string, actorId: string, quotationNo: string): Promise<void> {
  const orgId = await getTenantOrgId();
  const updated = await updateById(leads, orgId, leadId, { status: "Order_Confirmed" });
  if (!updated) throw new LeadError("Lead nahi mila.");
  await logLeadActivity(orgId, leadId, "Won", `Order Confirmed — quotation ${quotationNo} accept ho gaya.`, actorId);
}
