import Link from "next/link";

/** Visibility is derived by the caller from the live COST_SHEETS grant.
 * The destination performs its own server-side authorization on every request. */
export default function CostSheetLink({ sku, canView, label }: {
  sku: string;
  canView: boolean;
  label: string;
}) {
  if (!canView) return null;
  return <Link href={`/cost-sheets?productSku=${encodeURIComponent(sku)}`} className="inline-flex items-center rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{label}</Link>;
}
