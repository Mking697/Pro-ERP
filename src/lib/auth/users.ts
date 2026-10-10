import bcrypt from "bcryptjs";
import { and, eq, sql, type InferSelectModel } from "drizzle-orm";
import { db, runInTenantTransaction } from "@/db/client";
import { users } from "@/db/schema";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import {
  getOrganization,
  indexUser,
  isEmailTaken,
  removeIndexedUser,
  updateIndexedUserStatus,
} from "@/lib/platform/registry";
import { serializeModuleAccess } from "@/lib/moduleAccess";
import { getPlanLimit } from "@/lib/platform/planLimits";

/**
 * Mirrors the pre-Postgres SheetUser shape exactly (same field names, same casing) even
 * though the persistence underneath is now the `users` Postgres table — the goal is zero
 * changes at the dozens of call sites across the app that read `.Full_Name`, `.Role`,
 * `.Module_Access`, etc. off this type.
 */
export interface SheetUser {
  User_ID: string;
  Full_Name: string;
  Email: string;
  Password_Hash: string;
  Role: string;
  Department: string;
  Phone_Number: string;
  Status: string;
  Created_At: string;
  Created_By: string;
  /** Comma-separated module keys — see src/lib/moduleAccess.ts. */
  Module_Access: string;
  /** FMS shift id (e.g. "1", "2") — see src/lib/fms/calendar.ts. Blank defaults to "1". */
  Shift: string;
  /** Another user's id, or "" — this person's Leave approval chain "Reporting Manager"
   * step resolves to whoever this points to. See src/lib/leave/*.ts. */
  Reporting_Manager_ID: string;
  /** ISO timestamp of when Status last flipped Active -> Inactive, or null — set/cleared by
   * updateUser() on a real status transition. See src/lib/payroll/payroll.ts's
   * computeDaysEmployed() for the one place this is actually read. */
  Deactivated_At: string | null;
  /** Bumped on every role/status/module-access change or password reset — baked into the
   * session JWT at login and re-checked on every guarded request (requireSession) so an
   * already-issued cookie stops working the moment the account changes, instead of staying
   * valid for the rest of its 8h TTL. See session.ts's SessionPayload.tokenVersion. */
  Token_Version: number;
}

// Also excluded from the client-facing shape: it is purely a server-side revocation
// counter (see its own comment on SheetUser), never something a client needs to read.
export type SafeSheetUser = Omit<SheetUser, "Password_Hash" | "Token_Version">;

export function toSafeUser(user: SheetUser): SafeSheetUser {
  return {
    User_ID: user.User_ID,
    Full_Name: user.Full_Name,
    Email: user.Email,
    Role: user.Role,
    Department: user.Department,
    Phone_Number: user.Phone_Number,
    Status: user.Status,
    Created_At: user.Created_At,
    Created_By: user.Created_By,
    Module_Access: user.Module_Access ?? "",
    Shift: user.Shift ?? "",
    Reporting_Manager_ID: user.Reporting_Manager_ID ?? "",
    Deactivated_At: user.Deactivated_At ?? null,
  };
}

type UserRow = InferSelectModel<typeof users>;

function rowToSheetUser(row: UserRow): SheetUser {
  return {
    User_ID: row.id,
    Full_Name: row.fullName,
    Email: row.email,
    Password_Hash: row.passwordHash,
    Role: row.role,
    Department: row.department,
    Phone_Number: row.phoneNumber,
    Status: row.status,
    Created_At: row.createdAt.toISOString(),
    Created_By: row.createdBy,
    Module_Access: row.moduleAccess.join(","),
    Shift: row.shift,
    Reporting_Manager_ID: row.reportingManagerId,
    Deactivated_At: row.deactivatedAt ? row.deactivatedAt.toISOString() : null,
    Token_Version: Number(row.tokenVersion) || 0,
  };
}

/** CSV of module keys (validated/ordered by MODULE_ACCESS) -> the array the column stores. */
function moduleAccessToArray(keys: readonly string[]): string[] {
  const csv = serializeModuleAccess(keys);
  return csv ? csv.split(",") : [];
}

async function getUserRow(orgId: string, userId: string): Promise<UserRow | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(and(eq(users.orgId, orgId), eq(users.id, userId)))
    .limit(1);
  return row ?? null;
}

/**
 * Always reads fresh — login must never authenticate against a stale password hash or a
 * since-deactivated account. (No caching layer sits in front of this read at all now, so
 * "fresh" is simply what a normal indexed Postgres read already is.)
 *
 * Scoped to the current tenant's org_id, mirroring how the Sheets-era version was
 * implicitly scoped to "whichever spreadsheet getTenantSheetId() resolved to." Email is
 * unique platform-wide (see the platform registry), so this filter is defense in depth
 * rather than the only thing narrowing the match.
 *
 * Queries by the indexed (org_id, email) pair directly instead of loading every user row
 * in the organization and filtering in JS — this sits on the login path, so it used to mean
 * every sign-in read the whole tenant's Users table just to find one row.
 */
export async function findUserByEmail(email: string): Promise<SheetUser | null> {
  const orgId = await getTenantOrgId();
  const normalized = email.trim().toLowerCase();
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.orgId, orgId), sql`lower(${users.email}) = ${normalized}`))
    .limit(1);
  return rows[0] ? rowToSheetUser(rows[0]) : null;
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function getUserById(userId: string): Promise<SheetUser | null> {
  const orgId = await getTenantOrgId();
  const row = await getUserRow(orgId, userId);
  return row ? rowToSheetUser(row) : null;
}

export async function listUsers(): Promise<SheetUser[]> {
  const orgId = await getTenantOrgId();
  const rows = await db.select().from(users).where(eq(users.orgId, orgId));
  return rows.map(rowToSheetUser);
}

interface CreateUserInput {
  fullName: string;
  email: string;
  password: string;
  role: string;
  department: string;
  phoneNumber: string;
  createdBy: string;
  moduleAccess?: readonly string[];
  shift?: string;
  reportingManagerId?: string;
}

/**
 * Usage-limit gate (src/lib/platform/planLimits.ts) — the only billing enforcement this
 * codebase has (no payment gateway; a Platform Admin changes `plan` by hand from
 * /platform). Counts every Active row, mirroring the same "Active users" figure
 * /api/platform/organizations already shows. A Trial org (or an org with no plan on
 * record) gets `null` here — unlimited, matching Trial's own "full feature set" promise.
 *
 * Shared by createUser() and updateUser()'s reactivate path (OPS-03): admitting a new
 * Active user is the same org-level decision whether the row is brand new or a disabled
 * one being turned back on, so both call this instead of each re-deriving their own
 * count. MUST be called from inside the same runInTenantTransaction(orgId, ...) scope as
 * the insert/update it is guarding — see those call sites for why.
 */
async function assertActiveUserCapAvailable(orgId: string, plan: string | null | undefined): Promise<void> {
  const limit = getPlanLimit(plan ?? "Trial").maxActiveUsers;
  if (limit === null) return;
  const activeCount = await db
    .select()
    .from(users)
    .where(and(eq(users.orgId, orgId), eq(users.status, "Active")));
  if (activeCount.length >= limit) {
    throw new Error(
      `"${plan ?? "Trial"}" plan par sirf ${limit} active users ho sakte hain. Kisi user ko deactivate karein ya plan upgrade karayein.`
    );
  }
}

export async function createUser(input: CreateUserInput): Promise<SheetUser> {
  const orgId = await getTenantOrgId();
  const normalizedEmail = input.email.trim().toLowerCase();

  // The login form asks only for an email, so an address has to identify exactly one
  // account across the whole platform — not just within this organization.
  if (await isEmailTaken(normalizedEmail)) {
    throw new Error("Is email se pehle se ek user maujood hai.");
  }

  const org = await getOrganization(orgId);
  const userId = generateId("UID");
  const passwordHash = await hashPassword(input.password);

  // Cap check + insert run inside one org-serialized transaction — the same
  // pg_advisory_xact_lock-backed runInTenantTransaction() every other org-level admission
  // decision in this codebase already uses (see src/db/client.ts's `admit()`). Without
  // this, two concurrent creates (or a create racing a reactivate — see updateUser())
  // targeting the organization's last available slot could both read "under the cap"
  // before either writes; the lock makes the second call block until the first commits,
  // then re-read the now-updated count.
  const row = await runInTenantTransaction(orgId, async () => {
    await assertActiveUserCapAvailable(orgId, org?.plan);
    const [inserted] = await db
      .insert(users)
      .values({
        id: userId,
        orgId,
        fullName: input.fullName,
        email: input.email,
        passwordHash,
        role: input.role,
        department: input.department,
        phoneNumber: input.phoneNumber,
        status: "Active",
        createdBy: input.createdBy,
        moduleAccess: moduleAccessToArray(input.moduleAccess ?? []),
        shift: input.shift?.trim() || "1",
        reportingManagerId: input.reportingManagerId?.trim() ?? "",
      })
      .returning();
    return inserted;
  });

  const newUser = rowToSheetUser(row);

  // The platform index is what lets login find this user's organization from their
  // email alone, without scanning every tenant's Users table.
  await indexUser({
    email: normalizedEmail,
    orgId,
    userId,
    status: newUser.Status as "Active" | "Inactive",
  });

  return newUser;
}

interface UpdateUserInput {
  role?: string;
  department?: string;
  phoneNumber?: string;
  status?: string;
  moduleAccess?: readonly string[];
  shift?: string;
  reportingManagerId?: string;
}

export async function updateUser(userId: string, patch: UpdateUserInput): Promise<SheetUser> {
  const orgId = await getTenantOrgId();
  // Every update shares the admission lock: even a department-only patch must
  // decide from the current row, not an Active snapshot from before deactivation.
  const { updated, statusChanged } = await runInTenantTransaction(orgId, async () => {
    const found = await getUserRow(orgId, userId);
    if (!found) {
      throw new Error("User nahi mila.");
    }

    const newRole = patch.role ?? found.role;
    const newStatus = (patch.status ?? found.status) as "Active" | "Inactive";

    // Retain the statement-level last-Admin guard (also used by deleteUser).
    // The tenant lock serializes updateUser decisions; the locked EXISTS additionally
    // refuses removal unless another Active Admin still matches at write time.
    const demotedAwayFromAdmin = found.role === "Admin" && newRole !== "Admin";
    const deactivatingAdmin =
      found.role === "Admin" && found.status === "Active" && newStatus === "Inactive";
    const removesThisUsersAdminStatus = demotedAwayFromAdmin || deactivatingAdmin;

    // deactivatedAt tracks the real Active -> Inactive transition moment (used by Payroll's
    // computeDaysEmployed() to prorate a mid-month exit instead of zeroing the whole month).
    // Only touch it on a genuine flip; leave it exactly as-is when status isn't changing.
    let deactivatedAt = found.deactivatedAt;
    if (patch.status && patch.status !== found.status) {
      if (found.status === "Active" && newStatus === "Inactive") {
        deactivatedAt = new Date();
      } else if (found.status === "Inactive" && newStatus === "Active") {
        deactivatedAt = null; // reactivated — no current exit date
      }
    }

    // A role, status, or module-access change invalidates any session already issued for
    // this user — bumping tokenVersion is what makes requireSession() reject their old
    // cookie on the next request instead of letting it coast to the natural 8h expiry.
    const accessChanged =
      patch.moduleAccess !== undefined &&
      serializeModuleAccess(patch.moduleAccess) !== found.moduleAccess.join(",");
    const securityRelevantChange =
      (patch.role !== undefined && patch.role !== found.role) ||
      (patch.status !== undefined && patch.status !== found.status) ||
      accessChanged;

    // When this update would remove the target's own Admin status, require — as part of
    // the very same statement — that at least one OTHER Active Admin row already exists.
    // `FOR UPDATE` inside the subquery is what actually makes this atomic: without it,
    // Postgres evaluates a plain EXISTS against whatever was last committed when the
    // statement started, so two concurrent UPDATEs each demoting a different one of the
    // last two Admins both see "one other Admin still exists" and both succeed — leaving
    // zero (confirmed by a real concurrency test; a plain EXISTS alone was not enough).
    // `FOR UPDATE` takes a row lock on the matching admin row(s): the second transaction
    // blocks until the first commits, then re-reads that row fresh and re-checks the WHERE
    // predicate against its NEW state — by which point the first transaction's own demotion
    // has already flipped that row's role away from "Admin", so the second transaction's
    // EXISTS correctly evaluates to false.
    const anotherActiveAdminExists = sql`exists (
      select 1 from ${users}
      where ${users.orgId} = ${orgId}
        and ${users.role} = 'Admin'
        and ${users.status} = 'Active'
        and ${users.id} != ${userId}
      for update
    )`;

    const isReactivation = found.status === "Inactive" && newStatus === "Active";

    const performUpdate = () =>
      db
        .update(users)
        .set({
          role: newRole,
          department: patch.department ?? found.department,
          phoneNumber: patch.phoneNumber ?? found.phoneNumber,
          ...(patch.status !== undefined ? { status: newStatus } : {}),
          moduleAccess:
            patch.moduleAccess !== undefined
              ? moduleAccessToArray(patch.moduleAccess)
              : found.moduleAccess,
          shift: patch.shift?.trim() || found.shift,
          reportingManagerId:
            patch.reportingManagerId !== undefined
              ? patch.reportingManagerId.trim()
              : found.reportingManagerId,
          deactivatedAt,
          tokenVersion: securityRelevantChange
            ? sql`${users.tokenVersion} + 1`
            : sql`${users.tokenVersion}`,
        })
        .where(
          and(
            eq(users.orgId, orgId),
            eq(users.id, userId),
            removesThisUsersAdminStatus ? anotherActiveAdminExists : undefined
          )
        )
        .returning();

    // Only a genuine admission consumes a seat; all read/decision/write paths
    // already hold the same organization lock, including ordinary profile edits.
    if (isReactivation) {
      const org = await getOrganization(orgId);
      await assertActiveUserCapAvailable(orgId, org?.plan);
    }
    const [row] = await performUpdate();

    if (!row) {
      // Either the row vanished between the read above and here, or (the real reason this
      // guard exists) this was the organization's last Active Admin and the WHERE clause's
      // EXISTS check correctly refused to match any row.
      if (removesThisUsersAdminStatus) {
        throw new UserDeletionError(
          "Ye organization ka aakhri Admin hai. Pehle kisi aur ko Admin banayein."
        );
      }
      throw new Error("User nahi mila.");
    }

    return {
      updated: rowToSheetUser(row),
      statusChanged: Boolean(patch.status && patch.status !== found.status),
    };
  });

  if (statusChanged) {
    await updateIndexedUserStatus(updated.Email, updated.Status);
  }

  return updated;
}

export class UserDeletionError extends Error {}

/**
 * Removes a user from the organization, and frees their email across the platform.
 *
 * The row is genuinely removed rather than flagged, because that is what "delete" is
 * taken to mean — and because an email left in the platform index stays claimed for ever,
 * so the same person could never be added back.
 *
 * Their past work is not deleted with them: tasks carry the user id they were assigned
 * to, and those rows stay exactly as they are. That is deliberate — a completed task is a
 * record of something that happened, and it should not disappear because somebody left.
 * The screens fall back to showing the stored id where the name can no longer be resolved.
 */
export async function deleteUser(userId: string, actingUserId: string): Promise<void> {
  if (userId === actingUserId) {
    throw new UserDeletionError("Aap khud ko delete nahi kar sakte.");
  }

  const orgId = await getTenantOrgId();
  const found = await getUserRow(orgId, userId);
  if (!found) {
    throw new UserDeletionError("User nahi mila.");
  }

  // An organization with no Admin cannot be administered again — there would be nobody
  // left who can create users or manage settings. Folded into the DELETE's own WHERE
  // clause with a `FOR UPDATE` row lock on the subquery — same atomicity reason and same
  // mechanism as updateUser()'s own Admin guard (see that function's comment for the race
  // this closes and why a plain EXISTS alone doesn't).
  const isTargetAdmin = found.role === "Admin";
  const anotherActiveAdminExists = sql`exists (
    select 1 from ${users}
    where ${users.orgId} = ${orgId}
      and ${users.role} = 'Admin'
      and ${users.status} = 'Active'
      and ${users.id} != ${userId}
    for update
  )`;

  // The index entry goes first: if the second half fails, the user still exists and the
  // action can simply be retried. The other order would leave an email pointing nowhere.
  await removeIndexedUser(found.email);
  const [deleted] = await db
    .delete(users)
    .where(
      and(
        eq(users.orgId, orgId),
        eq(users.id, userId),
        isTargetAdmin ? anotherActiveAdminExists : undefined
      )
    )
    .returning({ id: users.id });

  if (!deleted) {
    // The delete's WHERE clause refused to match — this was the organization's last
    // Active Admin. Re-index the entry removed above so the email isn't left orphaned.
    await indexUser({
      email: found.email,
      orgId,
      userId: found.id,
      status: found.status,
    });
    throw new UserDeletionError(
      "Ye organization ka aakhri Admin hai. Pehle kisi aur ko Admin banayein."
    );
  }
}

export async function resetUserPassword(userId: string, newPassword: string): Promise<void> {
  const orgId = await getTenantOrgId();
  const found = await getUserRow(orgId, userId);
  if (!found) {
    throw new Error("User nahi mila.");
  }

  const passwordHash = await hashPassword(newPassword);
  // Bumping tokenVersion here too: a password reset is usually a response to a suspected
  // compromise, so the whole point is cutting off whatever session is currently live —
  // leaving the old cookie valid until its natural 8h expiry would defeat that.
  await db
    .update(users)
    .set({ passwordHash, tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(and(eq(users.orgId, orgId), eq(users.id, userId)));
}
