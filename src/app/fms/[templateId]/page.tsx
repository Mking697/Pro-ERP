import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import AppShell from "@/components/app-shell";
import PageHeader from "@/components/page-header";
import { getT } from "@/lib/i18n/server";
import { getFmsTemplateSteps, userCanAccessTemplate } from "@/lib/fms/templates";
import FlowBoard from "./flow-board";

/**
 * The operational view of one FMS flow the org owner designed (e.g. "Inward FMS": Material
 * Unload -> Verify vs Invoice -> IQC) — a named nav item's destination, not the generic
 * /fms page's flat "every template mixed together" tabs.
 *
 * Access mirrors the nav helper that decided whether this link was even shown
 * (src/lib/fms/templates.ts's userCanAccessTemplate): an FMS_ADMIN may open any template,
 * anyone else only one whose static step design assigns them. A stale/guessed URL to a
 * template the viewer has no business in bounces back to /fms rather than leaking the
 * flow's own step names and doers.
 */
export default async function FlowTemplatePage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const t = await getT();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) redirect("/login");

  const { templateId } = await params;

  const steps = await getFmsTemplateSteps(templateId);
  if (steps.length === 0) redirect("/fms");

  const isAdmin = session.access.includes("FMS_ADMIN");
  if (!userCanAccessTemplate(steps, session.userId, isAdmin)) redirect("/fms");

  const templateName = steps[0].Template_Name;

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title={templateName}
          description={t("Is flow ke saare instances — kaunsa step chal raha hai, kiske paas hai, aur ab tak kya hua.")}
        />
        <FlowBoard templateId={templateId} />
      </div>
    </AppShell>
  );
}
