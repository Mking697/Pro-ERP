import bcrypt from "bcryptjs";
import { getSheetRows, appendSheetRow, updateSheetRow, rowsToObjects } from "@/lib/tenantSheets";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import {
  indexUser,
  isEmailTaken,
  removeIndexedUser,
  updateIndexedUserStatus,
} from "@/lib/platform/registry";
import { deleteRow, getSheetsClient } from "@/lib/googleSheets";
import { getTenantSheetId } from "@/lib/tenant";
import { serializeModuleAccess } from "@/lib/moduleAccess";

const USERS_TAB = "Users";

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
  };
}

export const USERS_HEADERS: (keyof SheetUser)[] = [
  "User_ID",
  "Full_Name",
  "Email",
  "Password_Hash",
  "Role",
  "Department",
  "Phone_Number",
  "Status",
  "Created_At",
  "Created_By",
  "Module_Access",
];

function userToRow(user: SheetUser): string[] {
  return USERS_HEADERS.map((h) => user[h] ?? "");
}

// One check per warm instance per spreadsheet — the header only ever grows.
const headersEnsured = new Set<string>();

/**
 * Adds any columns the code knows about but the sheet's header row is missing.
 *
 * Rows are read back by matching against the sheet's own header row, so a column added
 * to USERS_HEADERS after an organization already connected its sheet would otherwise be
 * written into a position no header names — the value would be invisible on read. This
 * makes adding a column a code change instead of a manual instruction to every customer.
 */
export async function ensureUsersHeaders(): Promise<void> {
  const spreadsheetId = await getTenantSheetId();
  if (headersEnsured.has(spreadsheetId)) return;

  const rows = await getSheetRows(USERS_TAB);
  const existing = rows[0] ?? [];
  const missing = USERS_HEADERS.filter((h) => !existing.includes(h));

  if (missing.length > 0) {
    const sheets = getSheetsClient();
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${USERS_TAB}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [[...existing, ...missing]] },
    });
  }

  headersEnsured.add(spreadsheetId);
}

/**
 * Always reads fresh (no cache) — login must never authenticate against a stale
 * password hash or a since-deactivated account.
 */
export async function findUserByEmail(email: string): Promise<SheetUser | null> {
  const rows = await getSheetRows(USERS_TAB);
  const users = rowsToObjects<SheetUser>(rows);
  const normalized = email.trim().toLowerCase();
  return users.find((u) => u.Email?.trim().toLowerCase() === normalized) ?? null;
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function getUserById(userId: string): Promise<SheetUser | null> {
  const rows = await getSheetRows(USERS_TAB);
  const users = rowsToObjects<SheetUser>(rows);
  return users.find((u) => u.User_ID === userId) ?? null;
}

export async function listUsers(): Promise<SheetUser[]> {
  const rows = await getSheetRows(USERS_TAB);
  return rowsToObjects<SheetUser>(rows);
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
}

export async function createUser(input: CreateUserInput): Promise<SheetUser> {
  const orgId = await getTenantOrgId();
  await ensureUsersHeaders();
  const normalizedEmail = input.email.trim().toLowerCase();

  // The login form asks only for an email, so an address has to identify exactly one
  // account across the whole platform — not just within this organization.
  if (await isEmailTaken(normalizedEmail)) {
    throw new Error("Is email se pehle se ek user maujood hai.");
  }

  const userId = generateId("UID");
  const passwordHash = await hashPassword(input.password);

  const newUser: SheetUser = {
    User_ID: userId,
    Full_Name: input.fullName,
    Email: input.email,
    Password_Hash: passwordHash,
    Role: input.role,
    Department: input.department,
    Phone_Number: input.phoneNumber,
    Status: "Active",
    Created_At: new Date().toISOString(),
    Created_By: input.createdBy,
    Module_Access: serializeModuleAccess(input.moduleAccess ?? []),
  };

  await appendSheetRow(USERS_TAB, userToRow(newUser));

  // The platform index is what lets login find this user's organization from their
  // email alone, without scanning every tenant's Users tab.
  await indexUser({
    Email: normalizedEmail,
    Org_ID: orgId,
    User_ID: userId,
    Status: newUser.Status,
  });

  return newUser;
}

async function findUserRow(userId: string): Promise<{ rowNumber: number; user: SheetUser } | null> {
  const rows = await getSheetRows(USERS_TAB);
  const rowIndex = rows.findIndex((row, i) => i > 0 && row[0] === userId);
  if (rowIndex === -1) return null;

  const user = rowsToObjects<SheetUser>([rows[0], rows[rowIndex]])[0];
  return { rowNumber: rowIndex + 1, user };
}

interface UpdateUserInput {
  role?: string;
  department?: string;
  phoneNumber?: string;
  status?: string;
  moduleAccess?: readonly string[];
}

export async function updateUser(userId: string, patch: UpdateUserInput): Promise<SheetUser> {
  await ensureUsersHeaders();
  const found = await findUserRow(userId);
  if (!found) {
    throw new Error("User nahi mila.");
  }

  const updated: SheetUser = {
    ...found.user,
    Role: patch.role ?? found.user.Role,
    Department: patch.department ?? found.user.Department,
    Phone_Number: patch.phoneNumber ?? found.user.Phone_Number,
    Status: patch.status ?? found.user.Status,
    Module_Access:
      patch.moduleAccess !== undefined
        ? serializeModuleAccess(patch.moduleAccess)
        : found.user.Module_Access,
  };

  await updateSheetRow(USERS_TAB, found.rowNumber, userToRow(updated));

  if (patch.status && patch.status !== found.user.Status) {
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

  await ensureUsersHeaders();
  const found = await findUserRow(userId);
  if (!found) {
    throw new UserDeletionError("User nahi mila.");
  }

  // An organization with no Admin cannot be administered again — there would be nobody
  // left who can create users or connect sheets.
  if (found.user.Role === "Admin") {
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
  await removeIndexedUser(found.user.Email);
  await deleteRow(await getTenantSheetId(), USERS_TAB, found.rowNumber);
}

export async function resetUserPassword(userId: string, newPassword: string): Promise<void> {
  const found = await findUserRow(userId);
  if (!found) {
    throw new Error("User nahi mila.");
  }

  const updated: SheetUser = {
    ...found.user,
    Password_Hash: await hashPassword(newPassword),
  };

  await updateSheetRow(USERS_TAB, found.rowNumber, userToRow(updated));
}
