import { NextResponse } from "next/server";
import { z } from "zod";
import { createOrganization, isEmailTaken } from "@/lib/platform/registry";
import { runWithTenant, tenantFromOrgId } from "@/lib/tenant";
import { createUser } from "@/lib/auth/users";
import { signSession, SESSION_COOKIE } from "@/lib/auth/session";
import { effectiveModuleAccess } from "@/lib/moduleAccess";
import { uploadOrgLogo, decodeDataUrl } from "@/lib/storage";
import { upsertSetting } from "@/lib/settings";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";

const SIGNUP_LIMIT = 5;
const SIGNUP_WINDOW_SECONDS = 60 * 60;
// A separate, tighter per-email cap alongside the IP cap above — mirrors login's own
// two-axis rate limit (see src/app/api/auth/login/route.ts's own comment on why). Without
// this, a distributed caller (rotating IPs, or sharing a NAT with many other IPs) could
// create unlimited accounts against the same victim email as fast as the IP cap alone
// allowed, since IP and email were never checked together.
const SIGNUP_EMAIL_LIMIT = 5;
const SIGNUP_EMAIL_WINDOW_SECONDS = 60 * 60;

const signupSchema = z.object({
  orgName: z.string().trim().min(2, "Organization ka naam daalein."),
  fullName: z.string().trim().min(2, "Apna naam daalein."),
  email: z.string().email(),
  password: z.string().min(8, "Password kam se kam 8 characters ka ho."),
  phoneNumber: z.string().trim().optional().default(""),
  /** Optional `data:image/png;base64,...` from the signup form. */
  logo: z.string().optional(),
});

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const rate = await checkRateLimit(
    "signup",
    clientIp(request),
    SIGNUP_LIMIT,
    SIGNUP_WINDOW_SECONDS
  );
  if (!rate.allowed) {
    return fail("Bahut zyada koshishein ho gayi hain. Thodi der baad try karein.", 429);
  }

  const body = await request.json().catch(() => null);
  const parsed = signupSchema.safeParse(body);

  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Form theek se bharein.");
  }

  const { orgName, fullName, email, password, phoneNumber, logo } = parsed.data;

  // Second axis: keyed on the submitted email itself, independent of which IP it came
  // from — see this file's own comment on SIGNUP_EMAIL_LIMIT for why the IP-only check
  // above isn't enough on its own.
  const emailRate = await checkRateLimit(
    "signup-email",
    email.toLowerCase(),
    SIGNUP_EMAIL_LIMIT,
    SIGNUP_EMAIL_WINDOW_SECONDS
  );
  if (!emailRate.allowed) {
    return fail("Bahut zyada koshishein ho gayi hain. Thodi der baad try karein.", 429);
  }

  if (await isEmailTaken(email)) {
    return fail("Is email se pehle se ek account maujood hai. Login karein.");
  }

  // Every organization shares the same Postgres schema — signup is just "insert one
  // organizations row," no external spreadsheet to create or verify access to.
  const org = await createOrganization({ orgName, ownerEmail: email });

  const tenant = await tenantFromOrgId(org.id);
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
        const url = await uploadOrgLogo(org.id, {
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
    orgId: org.id,
    email: admin.Email,
    fullName: admin.Full_Name,
    role: admin.Role,
    access: effectiveModuleAccess(admin.Role, admin.Module_Access),
    tokenVersion: admin.Token_Version,
  });

  const response = NextResponse.json({
    organization: { orgId: org.id, name: org.orgName, slug: org.slug },
    user: { userId: admin.User_ID, fullName: admin.Full_Name, email: admin.Email },
  });

  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  return response;
}
