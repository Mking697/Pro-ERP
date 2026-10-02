"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/preferences-provider";
import type { GuideChapter, GuideSection } from "@/lib/guide";

/** Every bit of text a section can show, flattened into one lowercase haystack so a
 * single `includes()` check covers title/summary/steps/notes/example — the guide's
 * content model has five different optional free-text shapes and a query shouldn't
 * have to know which one the answer happens to live in. */
function sectionHaystack(section: GuideSection): string {
  return [
    section.title,
    section.summary,
    ...(section.how ?? []),
    ...(section.steps ?? []),
    ...(section.notes ?? []),
    section.example?.title ?? "",
    ...(section.example?.lines ?? []),
  ]
    .join(" \n ")
    .toLowerCase();
}

export default function GuideBrowser({ chapters }: { chapters: GuideChapter[] }) {
  const t = useT();
  const [query, setQuery] = useState("");

  const normalized = query.trim().toLowerCase();

  const { filteredChapters, matchCount } = useMemo(() => {
    if (!normalized) return { filteredChapters: chapters, matchCount: 0 };
    let count = 0;
    const filtered = chapters
      .map((chapter) => {
        const sections = chapter.sections.filter((section) =>
          sectionHaystack(section).includes(normalized)
        );
        count += sections.length;
        return { ...chapter, sections };
      })
      .filter((chapter) => chapter.sections.length > 0);
    return { filteredChapters: filtered, matchCount: count };
  }, [chapters, normalized]);

  return (
    <div className="space-y-6">
      <div className="relative max-w-md">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("Guide mein dhoondein... (jaise 'stock', 'payroll', 'approval')")}
          aria-label={t("Guidebook search")}
          className="pl-9"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label={t("Search saaf karein")}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        )}
      </div>

      {normalized && (
        <p className="text-sm text-muted-foreground" role="status">
          {matchCount > 0
            ? t("{count} topic(s) mile \"{query}\" ke liye")
                .replace("{count}", String(matchCount))
                .replace("{query}", query)
            : t("Koi topic nahi mila \"{query}\" ke liye").replace("{query}", query)}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        {/* Contents list — on desktop it stays visible while the reader scrolls. Hidden
            entirely during an active search since the filtered list below already is
            the contents list. */}
        {!normalized && (
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
        )}

        <div className={normalized ? "min-w-0 space-y-8 lg:col-span-2" : "min-w-0 space-y-8"}>
          {filteredChapters.length === 0 && normalized && (
            <div className="rounded-2xl border border-dashed px-6 py-12 text-center">
              <p className="text-sm font-medium">{t("Koi topic nahi mila")}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("Kisi aur keyword se dhoondh kar dekhein, ya search saaf karke poori guide dekhein.")}
              </p>
            </div>
          )}

          {filteredChapters.map((chapter) => (
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
  );
}
