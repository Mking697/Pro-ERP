import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import {
  getLead,
  LeadError,
  logFollowUp,
  logMeetingOutcome,
  markLost,
  qualifyLead,
  saveNegotiation,
  scheduleMeeting,
} from "@/lib/leads/leads";

/** A non-Admin may only read/act on a lead assigned to them — mirrors listLeads()'s own
 * viewer scoping (src/lib/leads/leads.ts), so a Doer can't reach another salesperson's
 * lead just by guessing/sharing its leadId. Returns null (treated as 404) rather than a
 * distinct 403 so this doesn't leak whether the leadId exists at all. */
async function loadOwnedLead(leadId: string, session: { role: string; fullName: string }) {
  const detail = await getLead(leadId);
  if (!detail) return null;
  if (session.role !== "Admin" && detail.lead.assignedTo !== session.fullName) return null;
  return detail;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const guard = await requireModule("LEAD_FMS");
  if (!guard.ok) return guard.response;

  const { leadId } = await params;
  const detail = await loadOwnedLead(leadId, guard.session);
  if (!detail) {
    return NextResponse.json({ error: "Lead nahi mila." }, { status: 404 });
  }
  return NextResponse.json(detail);
}

const isoDatetime = z.string().trim().min(1).transform((v) => new Date(v));

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("qualify"),
    decision: z.enum(["Qualified", "Junk"]),
    note: z.string().trim().optional(),
  }),
  z.object({
    action: z.literal("followUp"),
    outcome: z.enum(["Interested", "Not_Interested", "Call_Back_Later"]),
    nextFollowUpAt: isoDatetime.optional(),
    note: z.string().trim().optional(),
  }),
  z.object({
    action: z.literal("scheduleMeeting"),
    meetingAt: isoDatetime,
    meetingMode: z.string().trim().optional().default(""),
  }),
  z.object({
    action: z.literal("meetingOutcome"),
    outcome: z.enum(["Done", "Reschedule", "Not_Interested"]),
    rescheduleAt: isoDatetime.optional(),
    note: z.string().trim().optional(),
  }),
  z.object({
    action: z.literal("negotiation"),
    notes: z.string().trim().min(1, "Requirement notes likhna zaroori hai."),
  }),
  z.object({
    action: z.literal("lost"),
    reason: z.string().trim().min(1, "Lost reason dena zaroori hai."),
  }),
]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const guard = await requireModule("LEAD_FMS");
  if (!guard.ok) return guard.response;

  const { leadId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid action." },
      { status: 400 }
    );
  }

  const actorId = guard.session.userId;
  const owned = await loadOwnedLead(leadId, guard.session);
  if (!owned) {
    return NextResponse.json({ error: "Lead nahi mila." }, { status: 404 });
  }

  try {
    switch (parsed.data.action) {
      case "qualify": {
        const lead = await qualifyLead(leadId, actorId, parsed.data.decision, parsed.data.note);
        return NextResponse.json({ lead });
      }
      case "followUp": {
        const lead = await logFollowUp(leadId, actorId, parsed.data.outcome, {
          nextFollowUpAt: parsed.data.nextFollowUpAt,
          note: parsed.data.note,
        });
        return NextResponse.json({ lead });
      }
      case "scheduleMeeting": {
        const lead = await scheduleMeeting(leadId, actorId, parsed.data.meetingAt, parsed.data.meetingMode);
        return NextResponse.json({ lead });
      }
      case "meetingOutcome": {
        const lead = await logMeetingOutcome(leadId, actorId, parsed.data.outcome, {
          rescheduleAt: parsed.data.rescheduleAt,
          note: parsed.data.note,
        });
        return NextResponse.json({ lead });
      }
      case "negotiation": {
        const lead = await saveNegotiation(leadId, actorId, parsed.data.notes);
        return NextResponse.json({ lead });
      }
      case "lost": {
        const lead = await markLost(leadId, actorId, parsed.data.reason);
        return NextResponse.json({ lead });
      }
    }
  } catch (err) {
    const message = err instanceof LeadError || err instanceof Error ? err.message : "Update nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
