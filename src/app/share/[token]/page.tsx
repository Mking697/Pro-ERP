import Link from "next/link";
import { getReportShare } from "@/lib/platform/shares";
import { runWithTenant, tenantFromOrgId } from "@/lib/tenant";
import { getOrganization } from "@/lib/platform/registry";
import { getSetting } from "@/lib/settings";
import { OrgLogo } from "@/components/logo-picker";
import Analytics from "@/app/dashboard/analytics";
import { getT } from "@/lib/i18n/server";

/**
 * A report, readable by anyone holding the link.
 *
 * Two rules govern this page, and both matter more than anything it renders:
 *
 * 1. The tenant is resolved from the token and from nothing else. It never reads the
 *    session cookie — a signed-in visitor from another organization must see the report
 *    the link belongs to, not their own data leaking through a shared URL.
 * 2. It only ever reads. There is no action on this page, and the grants come from the
 *    link rather than from the viewer, so nobody can widen what a link shows by holding
 *    an account somewhere.
 *
 * A revoked link, an unknown token and a suspended organization all produce the same
 * plain message. Telling a stranger which of the three it was would confirm that a token
 * once existed.
 */
export default async function SharedReportPage({
  params,
  searchParams,
}: PageProps<"/share/[token]">) {
  const { token } = await params;
  const sp = await searchParams;
  const t = await getT();

  const share = await getReportShare(token);
  if (!share) return <Unavailable message={t("Ye link ab kaam nahi karta.")} />;

  // tenantFromOrgId refuses a suspended organization, so a link stops working the moment
  // its organization is suspended — without this page having to check separately.
  let tenant;
  try {
    tenant = await tenantFromOrgId(share.Org_ID);
  } catch {
    return <Unavailable message={t("Ye link ab kaam nahi karta.")} />;
  }

  return runWithTenant(tenant, async () => {
    const [org, logoUrl] = await Promise.all([
      getOrganization(share.Org_ID),
      getSetting("ORG_LOGO_URL").catch(() => null),
    ]);

    const range = typeof sp.range === "string" ? sp.range : share.Range_Key;
    const from = typeof sp.from === "string" ? sp.from : share.From_Date || undefined;
    const to = typeof sp.to === "string" ? sp.to : share.To_Date || undefined;

    return (
      <div className="flex min-h-dvh flex-col bg-muted/30">
        <header className="border-b bg-background">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-2.5">
              <OrgLogo url={logoUrl} name={org?.Org_Name ?? "Pro ERP"} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold leading-tight">
                  {share.Label}
                </span>
                <span className="block truncate text-xs leading-tight text-muted-foreground">
                  {org?.Org_Name ?? ""}
                </span>
              </span>
            </div>
            <span className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
              {t("Live report — sirf padhne ke liye")}
            </span>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
          <Analytics
            session={{
              // No real person is viewing, so the personal section is switched off below
              // rather than being filled with somebody else's tasks.
              userId: "",
              orgId: share.Org_ID,
              email: "",
              fullName: "",
              role: "Viewer",
              access: share.Access ? share.Access.split(",") : [],
            }}
            rangeKey={range}
            from={from}
            to={to}
            hidePersonal
          />
        </main>

        <footer className="border-t bg-background">
          <div className="mx-auto w-full max-w-6xl px-4 py-3 text-xs text-muted-foreground sm:px-6">
            {t("Ye report live hai — page refresh karne par taaza data aata hai.")}{" "}
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
