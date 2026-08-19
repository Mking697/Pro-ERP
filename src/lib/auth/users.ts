import bcrypt from "bcryptjs";
import { getSheetRows, appendSheetRow, updateSheetRow, rowsToObjects } from "@/lib/tenantSheets";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { indexUser, isEmailTaken, updateIndexedUserStatus } from "@/lib/platform/registry";
import { getSheetsClient } from "@/lib/googleSheets";
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
