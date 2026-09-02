import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/guard";
import {
  createReportShare,
  listReportShares,
  revokeReportShare,
} from "@/lib/platform/shares";
import { canSeeEveryone, canSeeReport, getReport } from "@/lib/reports";

/**
 * The links this person is allowed to know about.
 *
 * Filtered here, on the server, and not by the caller. The dialog only ever wanted one
 * report's links and used to trim the list in the browser — but the response still
 * carried every token the organization had, and a token *is* the credential: anybody who
 * reads one can open `/share/<token>`, which renders with the grants stored on the link
 * rather than the grants of whoever is looking. So a doer with no modules at all could
 * fetch this endpoint, lift the token an Admin made for Performance or PPC, and read the
 * whole team's scores or the production plan — the exact things `requireModule()` refuses
 * them everywhere else.
 *
 * A share can only be created for a report the creator could see, so testing the caller's
 * own grants against each link's report is the same test, applied on the way back out.
 */
export async function GET(request: Request) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const wanted = new URL(request.url).searchParams.get("report");

  const shares = (await listReportShares(guard.session.orgId)).filter((s) => {
    if (wanted && s.Report !== wanted) return false;
    const definition = getReport(s.Report);
    // A link whose report this build no longer knows is not shown rather than assumed
    // harmless — an unknown id cannot be access-checked.
    return definition ? canSeeReport(definition, guard.session.access) : false;
  });

  return NextResponse.json({
    shares: shares.map((s) => ({
      token: s.Token,
      report: s.Report,
      label: s.Label,
      rangeKey: s.Range_Key,
      createdBy: s.Created_By,
      createdAt: s.Created_At,
    })),
  });
}

const createSchema = z.object({
  report: z.string().trim().min(1),
  label: z.string().trim().max(80).optional().default(""),
  rangeKey: z.string().trim().min(1).default("month"),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
});

export async function POST(request: Request) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  }

  try {
    // A personal report has no "you" on the other end of a public link, so it would
    // either be empty or show somebody else's work. Refused rather than rendered blank.
    const definition = getReport(parsed.data.report);
    if (!definition || definition.personal) {
      return NextResponse.json({ error: "Ye report share nahi ho sakti." }, { status: 400 });
    }
    if (!canSeeReport(definition, guard.session.access)) {
      return NextResponse.json({ error: "Is report ka access nahi hai." }, { status: 403 });
    }

    // A public link renders the organization's rows, not the creator's own slice of them.
    // So making one is an act of publishing everybody's work, and it belongs to somebody
    // already entitled to see everybody's work. Without this a doer restricted to their
    // own entries could mint a link and read the whole organization's through it — the
    // same escalation the listing endpoint had, arriving by a different door.
    if (!canSeeEveryone(guard.session)) {
      return NextResponse.json(
        {
          error:
            "Public link sirf Admin ya team-performance access wale bana sakte hain — link poore organization ka data dikhata hai.",
        },
        { status: 403 }
      );
    }

    const share = await createReportShare({
      orgId: guard.session.orgId,
      report: parsed.data.report,
      label: parsed.data.label,
      rangeKey: parsed.data.rangeKey,
      from: parsed.data.from,
      to: parsed.data.to,
      // Only what this person can already see. A link can never show more than the
      // person who made it was allowed to look at.
      access: guard.session.access,
      createdBy: guard.session.email,
    });
    return NextResponse.json({ token: share.Token, label: share.Label });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Link nahi ban paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!token) {
    return NextResponse.json({ error: "Token missing." }, { status: 400 });
  }

  try {
    // Scoped to the caller's own organization inside the library, so one tenant can
    // never revoke another's link by guessing a token.
    //
    // Within the organization, revoking is limited to whoever made the link and to an
    // Admin. Otherwise any colleague could quietly kill a link an Admin had shared with a
    // customer, and — because revoking deletes the row outright — there would be nothing
    // left to show it had ever existed or who removed it.
    const mine = (await listReportShares(guard.session.orgId)).find(
      (s) => s.Token === token
    );
    if (
      mine &&
      guard.session.role !== "Admin" &&
      mine.Created_By !== guard.session.email
    ) {
      return NextResponse.json(
        { error: "Ye link aapne nahi banaya. Sirf banane wala ya Admin ise band kar sakta hai." },
        { status: 403 }
      );
    }

    await revokeReportShare(guard.session.orgId, token);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Link band nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
