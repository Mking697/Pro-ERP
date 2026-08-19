import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guard";
import { getSetting, upsertSetting } from "@/lib/settings";
import { getTenantOrgId } from "@/lib/tenant";
import { uploadOrgLogo, decodeDataUrl, StorageUnavailableError } from "@/lib/storage";

const SETTING_KEY = "ORG_LOGO_URL";

export async function GET() {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  return NextResponse.json({ url: (await getSetting(SETTING_KEY)) ?? "" });
}

// An empty string clears the logo, which is how "Hatayein" is expressed.
const bodySchema = z.object({ logo: z.string() });

export async function POST(request: Request) {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  }

  if (!parsed.data.logo) {
    await upsertSetting(SETTING_KEY, "");
    return NextResponse.json({ url: "" });
  }

  const decoded = decodeDataUrl(parsed.data.logo);
  if (!decoded) {
    return NextResponse.json({ error: "Logo padha nahi ja saka." }, { status: 400 });
  }

  try {
    const url = await uploadOrgLogo(await getTenantOrgId(), {
      fileName: "logo",
      mimeType: decoded.mimeType,
      buffer: decoded.buffer,
    });
    await upsertSetting(SETTING_KEY, url);
    return NextResponse.json({ url });
  } catch (error) {
    if (error instanceof StorageUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[settings/logo] failed:", error);
    return NextResponse.json({ error: "Logo save nahi ho paya." }, { status: 500 });
  }
}
