import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guard";
import { getSetting, upsertSetting } from "@/lib/settings";
import { extractDriveFolderId } from "@/lib/sheetUrl";
import { verifyDriveFolderWritable } from "@/lib/googleDrive";

const SETTING_KEY = "DRIVE_FOLDER_URL";

export async function GET() {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const url = await getSetting(SETTING_KEY);
  return NextResponse.json({ url: url ?? "" });
}

const bodySchema = z.object({ url: z.string().min(1) });

export async function POST(request: Request) {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  }

  const folderId = extractDriveFolderId(parsed.data.url);
  if (!folderId) {
    return NextResponse.json(
      { error: "Yeh ek valid Google Drive folder URL nahi hai." },
      { status: 400 }
    );
  }

  // Checks writability, not just visibility — see verifyDriveFolderWritable.
  const check = await verifyDriveFolderWritable(folderId);
  if (!check.ok) {
    return NextResponse.json(
      { error: check.reason ?? "Is folder me file upload nahi ho payi." },
      { status: 400 }
    );
  }

  await upsertSetting(SETTING_KEY, parsed.data.url);
  return NextResponse.json({ success: true });
}
