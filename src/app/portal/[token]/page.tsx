import { headers } from "next/headers";
import Link from "next/link";
import { resolvePortalToken, getPortalOrders } from "@/lib/parties/customerPortal";
import { runWithTenant, tenantFromOrgId } from "@/lib/tenant";
import { getOrganization } from "@/lib/platform/registry";
import { getSetting } from "@/lib/settings";
import { findById } from "@/db/repo";
import { customers } from "@/db/schema";
import { OrgLogo } from "@/components/logo-picker";
import { Badge } from "@/components/ui/badge";
import { formatDueDisplay } from "@/lib/formatDate";
import { getT } from "@/lib/i18n/server";
import { checkRateLimit, clientIpFromHeaders } from "@/lib/rateLimit";

const PORTAL_LIMIT = 60;
const PORTAL_WINDOW_SECONDS = 5 * 60;

/**
 * A customer's own Orders/Invoices, readable by anyone holding the link — the Customer
 * Portal magic link (roadmap Phase 2 item #4). Same two rules as `/share/[token]`
 * (src/app/share/[token]/page.tsx), which this page's shape deliberately mirrors:
 *
 * 1. The tenant AND the customer are resolved from the token and from nothing else — never
 *    the session cookie. A signed-in visitor from another organization, or staff viewing
 *    another customer's data, must never leak through a shared URL.
 * 2. Read-only. No action exists on this page. Only Orders belonging to THIS customer and
 *    only Issued invoices are shown — never Draft invoices, never another customer's rows,
 *    never internal-only fields (margins, vendor cost, internal remarks).
 *
 * A revoked/unknown token and a suspended organization all produce the same plain message
 * — telling a stranger which of the two it was would confirm a token once existed.
 */
export default async function CustomerPortalPage({
  params,
}: PageProps<"/portal/[token]">) {
  const { token } = await params;
  const t = await getT();

  const ip = clientIpFromHeaders(await headers());
  const rate = await checkRateLimit("portal", ip, PORTAL_LIMIT, PORTAL_WINDOW_SECONDS);
  if (!rate.allowed) {
    return <Unavailable message={t("Bahut zyada koshishein ho gayi hain. Thodi der baad try karein.")} />;
  }

  const session = await resolvePortalToken(token);
  if (!session) return <Unavailable message={t("Ye link ab kaam nahi karta.")} />;

  let tenant;
  try {
    tenant = await tenantFromOrgId(session.orgId);
  } catch {
    return <Unavailable message={t("Ye link ab kaam nahi karta.")} />;
  }

  return runWithTenant(tenant, async () => {
    const [org, logoUrl, customer, orders] = await Promise.all([
      getOrganization(session.orgId),
      getSetting("ORG_LOGO_URL").catch(() => null),
      findById(customers, session.orgId, session.customerId),
      getPortalOrders(session.customerId),
    ]);

    if (!customer) return <Unavailable message={t("Ye link ab kaam nahi karta.")} />;

    return (
      <div className="flex min-h-dvh flex-col bg-muted/30">
        <header className="border-b bg-background">
          <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-2.5">
              <OrgLogo url={logoUrl} name={org?.orgName ?? "Pro ERP"} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold leading-tight">
                  {customer.customerName}
                </span>
                <span className="block truncate text-xs leading-tight text-muted-foreground">
                  {org?.orgName ?? ""}
                </span>
              </span>
            </div>
            <span className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
              {t("Aapke orders — sirf padhne ke liye")}
            </span>
          </div>
        </header>

        <main className="mx-auto w-full max-w-4xl flex-1 space-y-4 px-4 py-6 sm:px-6">
          {orders.length === 0 && (
            <div className="rounded-xl border bg-background p-8 text-center text-sm text-muted-foreground">
              {t("Abhi koi order nahi hai.")}
            </div>
          )}
          {orders.map((order) => (
            <div key={order.id} className="rounded-xl border bg-background p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{order.id}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDueDisplay(order.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{order.status.replace(/_/g, " ")}</Badge>
                  <span className="text-sm font-medium tabular-nums">
                    ₹{order.orderValue.toLocaleString("en-IN")}
                  </span>
                </div>
              </div>

              <div className="mt-3 space-y-1 border-t pt-3 text-sm">
                {order.items.map((item, i) => (
                  <div key={i} className="flex justify-between text-muted-foreground">
                    <span className="truncate">{item.itemName || item.sku}</span>
                    <span className="shrink-0 tabular-nums">
                      {item.qty} {item.uom}
                    </span>
                  </div>
                ))}
              </div>

              {order.invoices.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                  {order.invoices.map((inv) => (
                    <a
                      key={inv.id}
                      href={inv.attachmentUrl || undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`rounded-full border px-3 py-1 text-xs ${
                        inv.attachmentUrl
                          ? "text-primary underline underline-offset-2"
                          : "pointer-events-none text-muted-foreground"
                      }`}
                    >
                      {t("Invoice")} {inv.invoiceNo || inv.id} — ₹{inv.finalValue.toLocaleString("en-IN")}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </main>

        <footer className="border-t bg-background">
          <div className="mx-auto w-full max-w-4xl px-4 py-3 text-xs text-muted-foreground sm:px-6">
            {t("Ye page live hai — refresh karne par taaza data aata hai.")}{" "}
            <Link href="/login" className="underline underline-offset-2">
              Pro ERP
            </Link>
          </div>
        </footer>
      </div>
    );
  });
}

function Unavailable({ message }: { message: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/30 p-6">
      <div className="max-w-sm rounded-xl border bg-background p-8 text-center">
        <p className="text-sm font-medium">{message}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Jisne ye link bheja tha, unse naya link maangein.
        </p>
      </div>
    </div>
  );
}
