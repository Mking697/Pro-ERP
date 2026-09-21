import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { createLead, LeadError, listLeads, type LeadStatus } from "@/lib/leads/leads";

const STATUSES: LeadStatus[] = [
  "New",
  "Qualified",
  "Junk",
  "Follow_Up",
  "Meeting_Scheduled",
  "Negotiation",
  "Quotation_Sent",
  "Order_Confirmed",
  "Lost",
];

export async function GET(request: Request) {
  const guard = await requireModule("LEAD_FMS");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const status = STATUSES.includes(statusParam as LeadStatus) ? (statusParam as LeadStatus) : undefined;

  const leads = await listLeads(status);
  return NextResponse.json({ leads });
}

const createSchema = z.object({
  personName: z.string().trim().min(1, "Naam zaroori hai."),
  phone: z.string().trim().optional().default(""),
  email: z.string().trim().optional().default(""),
  companyName: z.string().trim().optional().default(""),
  city: z.string().trim().optional().default(""),
  state: z.string().trim().optional().default(""),
  source: z.string().trim().optional().default(""),
  productInterest: z.string().trim().optional().default(""),
  message: z.string().trim().optional().default(""),
  assignedTo: z.string().trim().optional().default(""),
});

export async function POST(request: Request) {
  const guard = await requireModule("LEAD_FMS");
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const { lead, warning } = await createLead({ ...parsed.data, createdBy: guard.session.userId });
    return NextResponse.json({ lead, warning });
  } catch (err) {
    const message = err instanceof LeadError || err instanceof Error ? err.message : "Lead ban nahi paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
