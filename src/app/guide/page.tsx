import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import { isPlatformAdmin } from "@/lib/platform/admin";
import { guideFor } from "@/lib/guide";
import { getLocale, getT } from "@/lib/i18n/server";
import AppShell from "@/components/app-shell";
import PageHeader from "@/components/page-header";
import GuideBrowser from "./guide-browser";

export default async function GuidePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) redirect("/login");

  const t = await getT();

  const chapters = guideFor({
    role: session.role,
    access: session.access,
    isPlatformAdmin: isPlatformAdmin(session.email),
    locale: await getLocale(),
  });

  const sectionCount = chapters.reduce((n, c) => n + c.sections.length, 0);

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title={t("Guidebook")}
          description={`${t("Sirf wahi cheezein jo aap is system me kar sakte hain")} — ${sectionCount} ${t("topics")}. ${t("Aapka access badlega to ye guide bhi apne aap badal jaayegi.")}`}
        />

        <GuideBrowser chapters={chapters} />
      </div>
    </AppShell>
  );
}
