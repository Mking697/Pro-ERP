import { NextResponse } from "next/server";
import { z } from "zod";
import { findUserByEmail, verifyPassword } from "@/lib/auth/users";
import { signSession, SESSION_COOKIE } from "@/lib/auth/session";
import { lookupUserOrg } from "@/lib/platform/registry";
import { tenantFromOrgId, runWithTenant, TenantResolutionError } from "@/lib/tenant";
import { effectiveModuleAccess } from "@/lib/moduleAccess";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please enter a valid email and password." },
      { status: 400 }
    );
  }

  const { email, password } = parsed.data;
  const invalid = NextResponse.json(
    { error: "Invalid email or password." },
    { status: 401 }
  );

  // The form asks only for an email, so the organization has to be discovered before
  // there is any sheet to check the password against.
  const indexed = await lookupUserOrg(email);
  if (!indexed || indexed.Status !== "Active") {
    return invalid;
  }

  let tenant;
  try {
    tenant = await tenantFromOrgId(indexed.Org_ID);
  } catch (error) {
    if (error instanceof TenantResolutionError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }

  const user = await runWithTenant(tenant, () => findUserByEmail(email));
  if (!user || user.Status !== "Active") {
    return invalid;
  }

  const passwordOk = await verifyPassword(password, user.Password_Hash);
  if (!passwordOk) {
    return invalid;
  }

  // Resolved once at login so every later guard is a token check, not a sheet read.
  const access = effectiveModuleAccess(user.Role, user.Module_Access);

  const token = await signSession({
    userId: user.User_ID,
    orgId: tenant.orgId,
    email: user.Email,
    fullName: user.Full_Name,
    role: user.Role,
    access,
  });

  const response = NextResponse.json({
    user: {
      userId: user.User_ID,
      fullName: user.Full_Name,
      email: user.Email,
      role: user.Role,
      access,
    },
    organization: {
      orgId: tenant.orgId,
      name: tenant.org.Org_Name,
      slug: tenant.org.Slug,
    },
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
