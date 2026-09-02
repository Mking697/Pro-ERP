/**
 * The list of reports, in one place.
 *
 * Four things need to agree on what reports exist: the index page, each report's own
 * page, the share dialog, and the public share page. When each kept its own list they
 * drifted — a report would appear on the index and 404 when opened, or be shareable
 * without the public page knowing how to draw it. This file is the only list.
 *
 * Deliberately free of server imports so a client component can read it too.
 */

export interface ReportDefinition {
  id: string;
  label: string;
  description: string;
  /**
   * Any one of these grants is enough to see it. Empty means everybody — every person
   * has tasks of their own, whatever else they can reach.
   */
  grants: readonly string[];
  /**
   * True when the report is about the person reading it.
   *
   * A personal report cannot be shared: there is no "you" on the other end of a public
   * link, so it would either be empty or, far worse, show somebody else's work.
   */
  personal?: boolean;
  /**
   * The fields on a row that say whose work it is.
   *
   * A grant answers "may this person open the inward report at all". It does not answer
   * "whose entries should they see in it" — and until now the answer to the second was
   * "everybody's", so anyone who could do a quality check could also read every party
   * name and invoice number the company had ever received. These fields are what let a
   * report be narrowed to the reader's own work.
   *
   * Several names are listed per report because the sheets are not uniform: some columns
   * hold a User_ID and some an email, and the domain objects rename the columns to
   * camelCase on the way through. The matcher tries each key and takes the first present.
   *
   * Omitted where a report has no per-person meaning at all — stock on a shelf is a fact
   * about the warehouse, not somebody's work.
   */
  ownerFields?: readonly string[];
}

export const REPORTS: readonly ReportDefinition[] = [
  {
    id: "tasks",
    label: "My tasks",
    description: "Aapko assign hue tasks — result aur samay ke saath.",
    grants: [],
    personal: true,
  },
  {
    id: "delegation",
    label: "Delegation",
    description: "Jo tasks aapne doosron ko diye.",
    grants: ["TASK_DELEGATE"],
    personal: true,
  },
  {
    id: "recurring",
    label: "Recurring",
    description: "Repeating rules aur unki haalat.",
    grants: ["RECURRING_ASSIGN"],
    ownerFields: ["Assigned_By"],
  },
  {
    id: "inward",
    label: "Inward",
    description: "Material inward entries aur unka IQC status.",
    grants: ["INWARD_ENTRY", "IQC_CHECK", "IMS_VIEW"],
    ownerFields: ["Created_By"],
  },
  {
    id: "iqc",
    label: "IQC",
    description: "Quality check ka nateeja — pass, fail aur kyun.",
    grants: ["IMS_VIEW"],
    ownerFields: ["Verified_By"],
  },
  {
    id: "ims",
    label: "IMS",
    description: "Verified stock jo andar aaya.",
    grants: ["IMS_VIEW"],
    ownerFields: ["Verified_By"],
  },
  {
    id: "inventory",
    label: "Inventory",
    description: "Aaj ka stock status aur reorder ki haalat.",
    grants: ["INVENTORY_VIEW"],
  },
  {
    id: "indents",
    label: "Indents",
    description: "Purchase requests aur unki haalat.",
    grants: ["INVENTORY_VIEW"],
    ownerFields: ["Requested_By", "Approved_By"],
  },
  {
    id: "bom",
    label: "BOM",
    description: "Kis product me kitne item lagte hain.",
    grants: ["BOM_MANAGE"],
    ownerFields: ["createdBy", "Created_By"],
  },
  {
    id: "ppc",
    label: "PPC",
    description: "Production plans aur unki haalat.",
    grants: ["PPC_PLAN"],
    ownerFields: ["createdBy", "startedBy", "Created_By", "Started_By"],
  },
  {
    id: "performance",
    label: "Performance",
    description: "Poori team ka MIS score, doer wise.",
    grants: ["PERFORMANCE_VIEW"],
  },
] as const;

export type ReportId = (typeof REPORTS)[number]["id"];

export function getReport(id: string): ReportDefinition | null {
  return REPORTS.find((r) => r.id === id) ?? null;
}

/** Whether these grants are enough to open a report. */
export function canSeeReport(
  report: ReportDefinition,
  access: readonly string[]
): boolean {
  if (report.grants.length === 0) return true;
  return report.grants.some((g) => access.includes(g));
}

export function reportsFor(access: readonly string[]): ReportDefinition[] {
  return REPORTS.filter((r) => canSeeReport(r, access));
}

/** The reports a public link may carry — personal ones can never be shared. */
export function shareableReports(access: readonly string[]): ReportDefinition[] {
  return reportsFor(access).filter((r) => !r.personal);
}

// ---------------------------------------------------------------------------
// Whose work a report shows
// ---------------------------------------------------------------------------

/**
 * Just enough of a session to answer "is this row mine".
 *
 * Declared structurally rather than importing SessionPayload, so this file keeps its one
 * useful property: no server imports, therefore readable from a client component too.
 */
export interface ReportViewer {
  userId: string;
  email: string;
  role: string;
  access: readonly string[];
}

/** `mine` shows only the reader's own work; `all` shows the whole organization. */
export type ReportScope = "mine" | "all";

export function parseReportScope(raw: string | undefined | null): ReportScope | null {
  return raw === "mine" || raw === "all" ? raw : null;
}

/**
 * Whether this person may look past their own work.
 *
 * Deliberately built from what already exists rather than from a new grant. Adding a key
 * to MODULE_ACCESS does not reach anybody already signed in — grants are baked into the
 * token at login — so a new "see everyone" checkbox would silently do nothing until every
 * user in every organization logged in again, Admins included.
 *
 * `PERFORMANCE_VIEW` is already exactly this permission wearing a different name: it is
 * what lets someone read the whole team's MIS score. Someone trusted with that is trusted
 * to see who raised which indent.
 */
export function canSeeEveryone(viewer: ReportViewer): boolean {
  return viewer.role === "Admin" || viewer.access.includes("PERFORMANCE_VIEW");
}

/**
 * The scope actually applied, given what was asked for and what is allowed.
 *
 * Everyone defaults to their own work. A request for `all` from somebody without the
 * privilege is quietly narrowed rather than refused — the URL is shared around and
 * bookmarked, and a 403 on a report they are entitled to read would be nonsense.
 */
export function resolveReportScope(
  requested: string | undefined | null,
  viewer: ReportViewer
): ReportScope {
  if (!canSeeEveryone(viewer)) return "mine";
  return parseReportScope(requested) ?? "mine";
}

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * Whether one row belongs to this viewer.
 *
 * Matches against both the user id and the email because the sheets genuinely hold both:
 * indents, the stock ledger and quality checks store a `User_ID`, while BOM, items and
 * production plans store an email. Normalising the write paths would have been tidier and
 * is not worth it — it cannot reach the rows customers already have, so the matcher has
 * to accept both regardless, and changing what new rows store would only split the data
 * again at a different point in time.
 *
 * A row with no owner recorded is nobody's. It shows under `all` and never under `mine`,
 * which is the honest answer for the inward entries written before the column existed:
 * the information was not captured, so it cannot be claimed.
 */
export function isOwnedBy(
  row: unknown,
  fields: readonly string[],
  viewer: ReportViewer
): boolean {
  if (!row || typeof row !== "object") return false;
  const record = row as Record<string, unknown>;
  const me = [normalize(viewer.userId), normalize(viewer.email)].filter(Boolean);

  return fields.some((field) => {
    const value = normalize(record[field]);
    return value !== "" && me.includes(value);
  });
}

/**
 * Narrows a list to the viewer's own rows.
 *
 * Returns the list untouched when the scope is `all`, or when the report declares no
 * owner fields — a report with nothing to attribute must not silently come back empty.
 */
export function scopeRows<T>(
  rows: T[],
  report: ReportDefinition,
  scope: ReportScope,
  viewer: ReportViewer
): T[] {
  if (scope === "all") return rows;
  const fields = report.ownerFields;
  if (!fields || fields.length === 0) return rows;
  return rows.filter((row) => isOwnedBy(row, fields, viewer));
}
