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
  },
  {
    id: "inward",
    label: "Inward",
    description: "Material inward entries aur unka IQC status.",
    grants: ["INWARD_ENTRY", "IQC_CHECK", "IMS_VIEW"],
  },
  {
    id: "iqc",
    label: "IQC",
    description: "Quality check ka nateeja — pass, fail aur kyun.",
    grants: ["IMS_VIEW"],
  },
  {
    id: "ims",
    label: "IMS",
    description: "Verified stock jo andar aaya.",
    grants: ["IMS_VIEW"],
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
  },
  {
    id: "bom",
    label: "BOM",
    description: "Kis product me kitne item lagte hain.",
    grants: ["BOM_MANAGE"],
  },
  {
    id: "ppc",
    label: "PPC",
    description: "Production plans aur unki haalat.",
    grants: ["PPC_PLAN"],
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
