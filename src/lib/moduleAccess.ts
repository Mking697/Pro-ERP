/**
 * Per-user feature grants, layered on top of Role.
 *
 * Role answers "how much privilege does this person have" (only an Admin manages users
 * and connections). Module access answers "which parts of the system is this person
 * actually meant to work in" — an Admin ticks the boxes per user, and the granted
 * modules are what shows up on that person's dashboard.
 *
 * The two are deliberately separate: previously "can assign tasks" was baked into the
 * role list (Admin/MD/Delegator), so giving one person the ability to assign a task
 * meant promoting them. Now it is a checkbox.
 */

export const MODULE_ACCESS = [
  {
    key: "TASK_DELEGATE",
    label: "Task Delegate",
    description: "Doosron ko one-time task assign kar sakta hai",
    href: "/tasks",
  },
  {
    key: "RECURRING_ASSIGN",
    label: "Recurring Task Assign",
    description: "Repeating task rules bana sakta hai",
    href: "/tasks",
  },
  {
    key: "INWARD_ENTRY",
    label: "Inward Entry",
    description: "Nayi inward entry daal sakta hai",
    href: "/inward",
  },
  {
    key: "IQC_CHECK",
    label: "IQC Quality Check",
    description: "Inward entries ka quality check kar sakta hai",
    href: "/inward",
  },
  {
    key: "IMS_VIEW",
    label: "IMS / Failure Log",
    description: "Verified stock aur failure records dekh sakta hai",
    href: "/inward",
  },
  {
    key: "INVENTORY_VIEW",
    label: "Inventory",
    description: "Items aur unka live stock dekh sakta hai",
    href: "/inventory",
  },
  {
    key: "INVENTORY_TXN",
    label: "Stock In / Out",
    description: "Material andar-bahar ki entry kar sakta hai",
    href: "/inventory",
  },
  {
    key: "INVENTORY_SETUP",
    label: "Item Master Setup",
    description: "Naye items bana sakta hai aur Max Level, Lead Time jaise settings bhar sakta hai",
    href: "/inventory/setup",
  },
  {
    key: "BOM_MANAGE",
    label: "BOM",
    description: "Product ki Bill of Materials bana aur badal sakta hai",
    href: "/bom",
  },
  {
    key: "INDENT_APPROVE",
    label: "Indent Approval",
    description: "Purchase indents approve aur receive kar sakta hai",
    href: "/inventory/indents",
  },
  {
    key: "PERFORMANCE_VIEW",
    label: "Team Performance",
    description: "Poori team ka MIS score dekh sakta hai",
    href: "/performance",
  },
] as const;

export type ModuleAccessKey = (typeof MODULE_ACCESS)[number]["key"];

export const MODULE_ACCESS_KEYS = MODULE_ACCESS.map((m) => m.key) as ModuleAccessKey[];

export function getModuleAccessDefinition(key: string) {
  return MODULE_ACCESS.find((m) => m.key === key) ?? null;
}

/** Sheet cell -> keys. Unknown entries are dropped so a typo cannot grant anything. */
export function parseModuleAccess(raw: string | undefined | null): ModuleAccessKey[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is ModuleAccessKey => MODULE_ACCESS_KEYS.includes(s as ModuleAccessKey));
}

/** Keys -> sheet cell. Order follows MODULE_ACCESS so the column stays readable. */
export function serializeModuleAccess(keys: readonly string[]): string {
  const wanted = new Set(keys.map((k) => k.trim().toUpperCase()));
  return MODULE_ACCESS_KEYS.filter((k) => wanted.has(k)).join(",");
}

/**
 * An Admin implicitly holds every grant. Without this an Admin could untick their own
 * boxes and lock the organization out of its own modules.
 */
export function effectiveModuleAccess(
  role: string,
  raw: string | undefined | null
): ModuleAccessKey[] {
  if (role === "Admin") return [...MODULE_ACCESS_KEYS];
  return parseModuleAccess(raw);
}

export function hasModuleAccess(
  access: readonly string[],
  key: ModuleAccessKey
): boolean {
  return access.includes(key);
}
