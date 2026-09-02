import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guard";
import { getAllSettings, upsertSetting } from "@/lib/settings";
import { MODULE_SHEETS, getModuleDefinition, invalidateModuleTarget, verifySheetAccess } from "@/lib/moduleSheets";
import { extractSpreadsheetId } from "@/lib/sheetUrl";
import { listOrganizations } from "@/lib/platform/registry";

const bodySchema = z.object({
  moduleKey: z.string().refine((val) => MODULE_SHEETS.some((m) => m.key === val), {
    message: "Unknown module.",
  }),
  url: z.string().min(1),
});

export async function GET() {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const settings = await getAllSettings();
  const modules = MODULE_SHEETS.map((m) => ({
    key: m.key,
    label: m.label,
    url: settings[m.settingKey] ?? "",
  }));

  return NextResponse.json({ modules });
}

export async function POST(request: Request) {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  }

  const { moduleKey, url } = parsed.data;
  const def = getModuleDefinition(moduleKey);

  const spreadsheetId = extractSpreadsheetId(url);
  if (!spreadsheetId) {
    return NextResponse.json(
      { error: "Yeh ek valid Google Sheets URL nahi hai." },
      { status: 400 }
    );
  }

  const hasAccess = await verifySheetAccess(spreadsheetId);
  if (!hasAccess) {
    return NextResponse.json(
      {
        error:
          "Is sheet tak access nahi mil paya. Sheet ko Service Account email ke saath Editor access se share karein, phir dobara try karein.",
      },
      { status: 400 }
    );
  }

  // "Can the service account reach it" is not "does it belong to you". One service
  // account serves every tenant, so it can reach every customer's spreadsheet — which
  // means the check above passes just as happily for somebody else's sheet as for your
  // own. Signup already refuses a System sheet another organization has claimed; module
  // connections had no equivalent, so pasting another org's ID here pointed this org's
  // reads and writes straight into their data.
  //
  // A System sheet is the sharpest case and is refused outright, including this
  // organization's own: `resolveModuleTarget` falls back to the first tab when the URL
  // names no gid, that tab is `Users`, and rows are keyed by the sheet's own header — so
  // a module aimed at a System sheet serves `Email` and `Password_Hash` through an
  // ordinary module endpoint.
  const systemSheetOwner = (await listOrganizations()).find(
    (o) => o.System_Sheet_ID === spreadsheetId
  );
  if (systemSheetOwner) {
    return NextResponse.json(
      {
        error:
          systemSheetOwner.Org_ID === guard.session.orgId
            ? "Ye aapki System sheet hai (Users + Settings). Module ke liye alag spreadsheet banayein."
            : "Ye spreadsheet kisi aur organization se judi hui hai.",
      },
      { status: 400 }
    );
  }

  await upsertSetting(def.settingKey, url);
  await invalidateModuleTarget(moduleKey);

  return NextResponse.json({ success: true });
}
