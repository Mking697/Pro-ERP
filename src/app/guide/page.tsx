import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import { isPlatformAdmin } from "@/lib/platform/admin";
import { guideFor } from "@/lib/guide";
import { getLocale, getT } from "@/lib/i18n/server";
import AppShell from "@/components/app-shell";
import PageHeader from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

        <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
          {/* Contents list — on desktop it stays visible while the reader scrolls. */}
          <nav
            aria-label={t("Guidebook contents")}
            className="hidden lg:block lg:sticky lg:top-32 lg:self-start"
          >
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("Contents")}
            </p>
            <ul className="space-y-1">
              {chapters.map((chapter) => (
                <li key={chapter.id}>
                  <a
                    href={`#${chapter.id}`}
                    className="block rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {chapter.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0 space-y-8">
            {chapters.map((chapter) => (
              <section key={chapter.id} id={chapter.id} className="scroll-mt-32">
                <h2 className="text-lg font-semibold tracking-tight">{chapter.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{chapter.description}</p>

                <div className="mt-4 space-y-4">
                  {chapter.sections.map((section) => (
                    <Card key={section.id} id={section.id} className="scroll-mt-32">
                      <CardHeader className="pb-3">
                        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                          {section.title}
                          {section.audience === "admin" && (
                            <Badge variant="secondary">Admin</Badge>
                          )}
                          {section.audience === "platform" && (
                            <Badge variant="secondary">Platform</Badge>
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4 text-sm">
                        <p className="text-muted-foreground">{section.summary}</p>

                        {section.how && (
                          <div className="space-y-2">
                            {section.how.map((para, i) => (
                              <p key={i}>{para}</p>
                            ))}
                          </div>
                        )}

                        {section.example && (
                          <figure className="rounded-lg border bg-muted/40">
                            <figcaption className="border-b px-3 py-2 text-xs font-medium">
                              {section.example.title}
                            </figcaption>
                            {/* Wide worked examples scroll inside the box rather than
                                stretching the page on a phone. */}
                            <div className="overflow-x-auto p-3">
                              <pre className="font-mono text-xs leading-relaxed">
                                {section.example.lines.map((line, i) => (
                                  <span key={i} className="block">
                                    {line}
                                  </span>
                                ))}
                              </pre>
                            </div>
                          </figure>
                        )}

                        {section.steps && (
                          <ol className="list-inside list-decimal space-y-1.5 marker:text-muted-foreground">
                            {section.steps.map((step, i) => (
                              <li key={i}>{step}</li>
                            ))}
                          </ol>
                        )}

                        {section.notes && (
                          <ul className="space-y-1.5 rounded-lg border bg-muted/40 p-3">
                            {section.notes.map((note, i) => (
                              <li key={i} className="flex gap-2 text-muted-foreground">
                                <span aria-hidden="true" className="select-none">
                                  •
                                </span>
                                <span>{note}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
