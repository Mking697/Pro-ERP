import bcrypt from "bcryptjs";
import { and, eq, type InferSelectModel } from "drizzle-orm";
import { db } from "@/db/client";
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
}

export type SafeSheetUser = Omit<SheetUser, "Password_Hash">;

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
 */
export async function findUserByEmail(email: string): Promise<SheetUser | null> {
  const orgId = await getTenantOrgId();
  const normalized = email.trim().toLowerCase();
  const rows = await db.select().from(users).where(eq(users.orgId, orgId));
  const match = rows.find((u) => u.email?.trim().toLowerCase() === normalized);
  return match ? rowToSheetUser(match) : null;
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

export async function createUser(input: CreateUserInput): Promise<SheetUser> {
  const orgId = await getTenantOrgId();
  const normalizedEmail = input.email.trim().toLowerCase();

  // The login form asks only for an email, so an address has to identify exactly one
  // account across the whole platform — not just within this organization.
  if (await isEmailTaken(normalizedEmail)) {
    throw new Error("Is email se pehle se ek user maujood hai.");
  }

  // Usage-limit gate (src/lib/platform/planLimits.ts) — the only billing enforcement this
  // codebase has (no payment gateway; a Platform Admin changes `plan` by hand from
  // /platform). Counts every Active row, mirroring the same "Active users" figure
  // /api/platform/organizations already shows.
  const org = await getOrganization(orgId);
  const limit = getPlanLimit(org?.plan ?? "Free").maxActiveUsers;
  if (limit !== null) {
    const activeCount = await db
      .select()
      .from(users)
      .where(and(eq(users.orgId, orgId), eq(users.status, "Active")));
    if (activeCount.length >= limit) {
      throw new Error(
        `"${org?.plan ?? "Free"}" plan par sirf ${limit} active users ho sakte hain. Kisi user ko deactivate karein ya plan upgrade karayein.`
      );
    }
  }

  const userId = generateId("UID");
  const passwordHash = await hashPassword(input.password);

  const [row] = await db
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
  const found = await getUserRow(orgId, userId);
  if (!found) {
    throw new Error("User nahi mila.");
  }

  const [row] = await db
    .update(users)
    .set({
      role: patch.role ?? found.role,
      department: patch.department ?? found.department,
      phoneNumber: patch.phoneNumber ?? found.phoneNumber,
      status: (patch.status ?? found.status) as "Active" | "Inactive",
      moduleAccess:
        patch.moduleAccess !== undefined
          ? moduleAccessToArray(patch.moduleAccess)
          : found.moduleAccess,
      shift: patch.shift?.trim() || found.shift,
      reportingManagerId:
        patch.reportingManagerId !== undefined
          ? patch.reportingManagerId.trim()
          : found.reportingManagerId,
    })
    .where(and(eq(users.orgId, orgId), eq(users.id, userId)))
    .returning();

  const updated = rowToSheetUser(row);

  if (patch.status && patch.status !== found.status) {
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
  // left who can create users or manage settings.
  if (found.role === "Admin") {
    const admins = (await listUsers()).filter(
      (u) => u.Role === "Admin" && u.Status === "Active"
    );
    if (admins.length <= 1) {
      throw new UserDeletionError(
        "Ye organization ka aakhri Admin hai. Pehle kisi aur ko Admin banayein."
      );
    }
  }

  // The index entry goes first: if the second half fails, the user still exists and the
  // action can simply be retried. The other order would leave an email pointing nowhere.
  await removeIndexedUser(found.email);
  await db.delete(users).where(and(eq(users.orgId, orgId), eq(users.id, userId)));
}

export async function resetUserPassword(userId: string, newPassword: string): Promise<void> {
  const orgId = await getTenantOrgId();
  const found = await getUserRow(orgId, userId);
  if (!found) {
    throw new Error("User nahi mila.");
  }

  const passwordHash = await hashPassword(newPassword);
  await db
    .update(users)
    .set({ passwordHash })
    .where(and(eq(users.orgId, orgId), eq(users.id, userId)));
}
