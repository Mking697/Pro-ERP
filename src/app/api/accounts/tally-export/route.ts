import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { generateTallyGlExport, TallyGlExportError } from "@/lib/accounts/tally";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Tally GL export (read-only) — masters + vouchers as two SEPARATE TallyXML documents,
 * `?part=masters` / `?part=vouchers`, because `serializeTallyExport()` returns two
 * independent `<ENVELOPE>` documents and concatenating two XML roots into one file would
 * not be valid XML. Masters must be imported into Tally BEFORE vouchers (see
 * tally-export.ts's own header comment) — the "Export to Tally" dialog downloads both, in
 * that order.
 *
 * This is a code-level/content-level correctness guarantee only — it has NOT been
 * verified against real Tally import/re-import behavior.
 */
export async function GET(request: Request) {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const fromDate = url.searchParams.get("fromDate") ?? "";
  const toDate = url.searchParams.get("toDate") ?? "";
  const part = url.searchParams.get("part") === "vouchers" ? "vouchers" : "masters";

  if (!YMD.test(fromDate) || !YMD.test(toDate)) {
    return NextResponse.json({ error: "fromDate aur toDate 'YYYY-MM-DD' format me dein." }, { status: 400 });
  }

  try {
    const result = await generateTallyGlExport({ fromDate, toDate });
    const xml = part === "vouchers" ? result.vouchersXml : result.mastersXml;
    const filename = `tally-${part}-${fromDate}-to-${toDate}.xml`;
    return new NextResponse(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof TallyGlExportError || error instanceof Error
      ? error.message
      : "Tally export fail ho gaya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
