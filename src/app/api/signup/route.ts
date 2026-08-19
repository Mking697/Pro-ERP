import { NextResponse } from "next/server";
import { z } from "zod";
import { extractSpreadsheetId } from "@/lib/sheetUrl";
import { verifySheetAccess } from "@/lib/googleSheets";
import {
  ensurePlatformSheet,
  createOrganization,
  listOrganizations,
  isEmailTaken,
} from "@/lib/platform/registry";
import {
  bootstrapSystemSheet,
  systemSheetHasUsers,
  getServiceAccountEmail,
} from "@/lib/platform/provisioning";
import { runWithTenant, tenantFromOrgId } from "@/lib/tenant";
import { createUser } from "@/lib/auth/users";
import { signSession, SESSION_COOKIE } from "@/lib/auth/session";
import { effectiveModuleAccess } from "@/lib/moduleAccess";
import { uploadOrgLogo, decodeDataUrl } from "@/lib/storage";
import { upsertSetting } from "@/lib/settings";

const signupSchema = z.object({
  orgName: z.string().trim().min(2, "Organization ka naam daalein."),
  fullName: z.string().trim().min(2, "Apna naam daalein."),
  email: z.string().email(),
  password: z.string().min(8, "Password kam se kam 8 characters ka ho."),
  phoneNumber: z.string().trim().optional().default(""),
  systemSheetUrl: z.string().trim().min(1, "System sheet ka URL daalein."),
  /** Optional `data:image/png;base64,...` from the signup form. */
  logo: z.string().optional(),
});

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = signupSchema.safeParse(body);

  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Form theek se bharein.");
  }

  const { orgName, fullName, email, password, phoneNumber, systemSheetUrl, logo } =
    parsed.data;

  const spreadsheetId = extractSpreadsheetId(systemSheetUrl);
  if (!spreadsheetId) {
    return fail("Ye Google Sheet ka valid URL nahi lag raha.");
  }

  // The registry tabs are created on demand, so the very first organization to sign up
  // works against a blank platform spreadsheet without any manual setup.
  await ensurePlatformSheet();

  if (await isEmailTaken(email)) {
    return fail("Is email se pehle se ek account maujood hai. Login karein.");
  }

  if (!(await verifySheetAccess(spreadsheetId))) {
    return fail(
      `Is sheet tak pahunch nahi ho pa rahi. Sheet ko ${getServiceAccountEmail()} ke saath Editor access ke saath share karein, phir dobara try karein.`
    );
  }

  const orgs = await listOrganizations();
  if (orgs.some((o) => o.System_Sheet_ID === spreadsheetId)) {
    return fail("Ye sheet pehle se kisi aur organization se judi hui hai.");
  }

  // A sheet that already holds user rows belongs to someone — adopting it would hand
  // this signup control of those accounts.
  if (await systemSheetHasUsers(spreadsheetId)) {
    return fail(
      "Is sheet me pehle se users maujood hain. Ek blank spreadsheet banakar uska URL daalein."
    );
  }

  await bootstrapSystemSheet(spreadsheetId);

  const org = await createOrganization({
    orgName,
    systemSheetId: spreadsheetId,
    ownerEmail: email,
  });

  const tenant = await tenantFromOrgId(org.Org_ID);
  const admin = await runWithTenant(tenant, () =>
    createUser({
      fullName,
      email,
      password,
      role: "Admin",
      department: "Management",
      phoneNumber,
      createdBy: "Signup",
    })
  );

  // After the org exists, so the logo is stored under its own id and no unauthenticated
  // upload endpoint has to exist. A logo failure must not undo a successful signup —
  // the organization is created either way and can set a logo later from Settings.
  if (logo) {
    try {
      const decoded = decodeDataUrl(logo);
      if (decoded) {
        const url = await uploadOrgLogo(org.Org_ID, {
          fileName: "logo",
          mimeType: decoded.mimeType,
          buffer: decoded.buffer,
        });
        await runWithTenant(tenant, () => upsertSetting("ORG_LOGO_URL", url));
      }
    } catch (error) {
      console.error("[signup] logo upload failed, continuing:", error);
    }
  }

  const token = await signSession({
    userId: admin.User_ID,
    orgId: org.Org_ID,
    email: admin.Email,
    fullName: admin.Full_Name,
    role: admin.Role,
    access: effectiveModuleAccess(admin.Role, admin.Module_Access),
  });

  const response = NextResponse.json({
    organization: { orgId: org.Org_ID, name: org.Org_Name, slug: org.Slug },
    user: { userId: admin.User_ID, fullName: admin.Full_Name, email: admin.Email },
  });

  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  return response;
}
