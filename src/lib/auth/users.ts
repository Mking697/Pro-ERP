import bcrypt from "bcryptjs";
import { getSheetRows, appendSheetRow, updateSheetRow, rowsToObjects } from "@/lib/googleSheets";

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
  };
}

const USERS_HEADERS: (keyof SheetUser)[] = [
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
];

function userToRow(user: SheetUser): string[] {
  return USERS_HEADERS.map((h) => user[h] ?? "");
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
}

export async function createUser(input: CreateUserInput): Promise<SheetUser> {
  const rows = await getSheetRows(USERS_TAB);
  const users = rowsToObjects<SheetUser>(rows);

  const normalizedEmail = input.email.trim().toLowerCase();
  if (users.some((u) => u.Email?.trim().toLowerCase() === normalizedEmail)) {
    throw new Error("Is email se pehle se ek user maujood hai.");
  }

  const userId = `UID${String(users.length + 1).padStart(3, "0")}`;
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
  };

  await appendSheetRow(USERS_TAB, userToRow(newUser));
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
}

export async function updateUser(userId: string, patch: UpdateUserInput): Promise<SheetUser> {
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
  };

  await updateSheetRow(USERS_TAB, found.rowNumber, userToRow(updated));
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
