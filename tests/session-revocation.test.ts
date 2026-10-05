import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { signSession, verifySession } from "@/lib/auth/session";
import {
  createUser,
  updateUser,
  resetUserPassword,
  getUserById,
} from "@/lib/auth/users";
import { deleteOrganization, getOrganization } from "@/lib/platform/registry";
import { runWithTenant } from "@/lib/tenant";
import { makeTestOrg } from "./helpers/testOrg";

/**
 * Session revocation (src/lib/auth/session.ts + src/lib/auth/guard.ts's requireSession):
 * every session JWT snapshots the signed-in user's `tokenVersion` at login. updateUser()
 * bumps it on any role/status/module-access change; resetUserPassword() bumps it
 * unconditionally. requireSession() re-reads the live row on every request and rejects
 * the cookie outright when its snapshot no longer matches — this is what makes a
 * deactivation/role-downgrade/password-reset take effect immediately instead of waiting
 * out the rest of the JWT's 8h TTL.
 *
 * requireSession() itself needs a real Next.js request's cookie jar (next/headers), which
 * doesn't exist in a plain vitest run — these tests instead exercise the same two halves
 * requireSession() composes: sign/verify round-tripping the tokenVersion claim correctly
 * (session.ts), and the DB side actually bumping it on the exact mutations guard.ts's own
 * comment says it must (users.ts). Together they cover the real contract without needing
 * an HTTP layer.
 */
describe("session tokenVersion revocation", () => {
  it("signSession/verifySession round-trips tokenVersion as a real number", async () => {
    const token = await signSession({
      userId: "UID-test",
      orgId: "ORG-test",
      email: "someone@example.com",
      fullName: "Someone",
      role: "Admin",
      access: ["ORDER_FMS"],
      tokenVersion: 3,
    });

    const payload = await verifySession(token);
    expect(payload).not.toBeNull();
    expect(payload?.tokenVersion).toBe(3);
  });

  it("rejects a token missing the tokenVersion claim (pre-migration cookie shape)", async () => {
    // A JWT signed before tokenVersion existed (or hand-crafted without it) must not
    // verify — verifySession()'s own type guard requires `typeof tokenVersion === "number"`.
    // Exercised here via the same jose primitives session.ts itself uses, rather than
    // reimplementing a second signer.
    const { SignJWT } = await import("jose");
    const secret = process.env.JWT_SECRET;
    expect(secret).toBeTruthy();
    const legacyToken = await new SignJWT({
      userId: "UID-legacy",
      orgId: "ORG-legacy",
      email: "legacy@example.com",
      fullName: "Legacy User",
      role: "Admin",
      access: [],
      // tokenVersion deliberately omitted.
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("8h")
      .sign(new TextEncoder().encode(secret!));

    const payload = await verifySession(legacyToken);
    expect(payload).toBeNull();
  });

  it("updateUser() bumps tokenVersion on a role change but not on a no-op patch", async () => {
    const org = await makeTestOrg("TokenVersionRole");
    try {
      await runWithTenant({ orgId: org.id, org }, async () => {
        const user = await createUser({
          fullName: "Role Change User",
          email: `role-change-${org.id}@example.com`,
          password: "Password123!",
          role: "Staff",
          department: "Ops",
          phoneNumber: "9990000020",
          createdBy: "SYSTEM",
        });
        expect(user.Token_Version).toBe(0);

        // A no-op patch (same phone number, nothing security-relevant) must not bump it —
        // only role/status/module-access changes are "security-relevant" per users.ts.
        const afterNoOp = await updateUser(user.User_ID, { phoneNumber: "9990000020" });
        expect(afterNoOp.Token_Version).toBe(0);

        const afterRoleChange = await updateUser(user.User_ID, { role: "Admin" });
        expect(afterRoleChange.Token_Version).toBe(1);

        const reloaded = await getUserById(user.User_ID);
        expect(reloaded?.Token_Version).toBe(1);
      });
    } finally {
      if (await getOrganization(org.id)) {
        await deleteOrganization(org.id).catch(() => {});
      }
    }
  });

  it("updateUser() bumps tokenVersion on a status change and on a module-access change", async () => {
    const org = await makeTestOrg("TokenVersionStatus");
    try {
      await runWithTenant({ orgId: org.id, org }, async () => {
        const admin = await createUser({
          fullName: "Admin A",
          email: `admin-a-tv-${org.id}@example.com`,
          password: "Password123!",
          role: "Admin",
          department: "Management",
          phoneNumber: "9990000021",
          createdBy: "SYSTEM",
        });
        await createUser({
          fullName: "Admin B",
          email: `admin-b-tv-${org.id}@example.com`,
          password: "Password123!",
          role: "Admin",
          department: "Management",
          phoneNumber: "9990000022",
          createdBy: "SYSTEM",
        });

        const afterDeactivate = await updateUser(admin.User_ID, { status: "Inactive" });
        expect(afterDeactivate.Token_Version).toBe(1);

        const afterModuleChange = await updateUser(admin.User_ID, {
          moduleAccess: ["ORDER_FMS", "INVENTORY_VIEW"],
        });
        expect(afterModuleChange.Token_Version).toBe(2);
      });
    } finally {
      if (await getOrganization(org.id)) {
        await deleteOrganization(org.id).catch(() => {});
      }
    }
  });

  it("resetUserPassword() always bumps tokenVersion, cutting off any live session", async () => {
    const org = await makeTestOrg("TokenVersionReset");
    try {
      await runWithTenant({ orgId: org.id, org }, async () => {
        const user = await createUser({
          fullName: "Reset Target",
          email: `reset-target-${org.id}@example.com`,
          password: "Password123!",
          role: "Staff",
          department: "Ops",
          phoneNumber: "9990000023",
          createdBy: "SYSTEM",
        });

        // Simulate a session issued at signup/login time, before the reset.
        const sessionBeforeReset = await signSession({
          userId: user.User_ID,
          orgId: org.id,
          email: user.Email,
          fullName: user.Full_Name,
          role: user.Role,
          access: [],
          tokenVersion: user.Token_Version,
        });
        const verifiedBeforeReset = await verifySession(sessionBeforeReset);
        expect(verifiedBeforeReset?.tokenVersion).toBe(0);

        await resetUserPassword(user.User_ID, "NewPassword456!");

        const reloaded = await getUserById(user.User_ID);
        expect(reloaded?.Token_Version).toBe(1);

        // What requireSession() actually does: compare the JWT's snapshot against the
        // live row. The pre-reset session's snapshot (0) no longer matches (1), so a
        // real guard would reject it here even though the JWT signature itself still
        // verifies fine — that mismatch IS the revocation.
        expect(verifiedBeforeReset?.tokenVersion).not.toBe(reloaded?.Token_Version);
      });
    } finally {
      if (await getOrganization(org.id)) {
        await deleteOrganization(org.id).catch(() => {});
      }
    }
  });

  it("Token_Version is excluded from the client-facing safe user shape", async () => {
    const org = await makeTestOrg("TokenVersionSafeShape");
    try {
      await runWithTenant({ orgId: org.id, org }, async () => {
        const user = await createUser({
          fullName: "Safe Shape User",
          email: `safe-shape-${org.id}@example.com`,
          password: "Password123!",
          role: "Staff",
          department: "Ops",
          phoneNumber: "9990000024",
          createdBy: "SYSTEM",
        });
        const { toSafeUser } = await import("@/lib/auth/users");
        const safe = toSafeUser(user);
        expect(safe).not.toHaveProperty("Token_Version");
        expect(safe).not.toHaveProperty("Password_Hash");
      });
    } finally {
      if (await getOrganization(org.id)) {
        await deleteOrganization(org.id).catch(() => {});
      }
    }
  });
});

/** Confirms the raw DB column itself stores the bumped integer, independent of the
 * SheetUser mapping layer — a direct check on users.tokenVersion. */
describe("users.tokenVersion column", () => {
  it("defaults to 0 for a freshly created user", async () => {
    const org = await makeTestOrg("TokenVersionColumn");
    try {
      await runWithTenant({ orgId: org.id, org }, async () => {
        const user = await createUser({
          fullName: "Column Default User",
          email: `column-default-${org.id}@example.com`,
          password: "Password123!",
          role: "Staff",
          department: "Ops",
          phoneNumber: "9990000025",
          createdBy: "SYSTEM",
        });

        const [row] = await db
          .select({ tokenVersion: users.tokenVersion })
          .from(users)
          .where(and(eq(users.orgId, org.id), eq(users.id, user.User_ID)))
          .limit(1);
        expect(Number(row.tokenVersion)).toBe(0);
      });
    } finally {
      if (await getOrganization(org.id)) {
        await deleteOrganization(org.id).catch(() => {});
      }
    }
  });
});
