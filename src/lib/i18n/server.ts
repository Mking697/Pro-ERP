import { cookies } from "next/headers";
import { LOCALE_COOKIE, parseLocale, type Locale } from "@/lib/preferences";
import { translatorFor, type Translator } from "@/lib/i18n";

/** The reader's locale, for server components and route handlers. */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  return parseLocale(store.get(LOCALE_COOKIE)?.value);
}

/**
 * A translator for a server-rendered tree.
 *
 * Server and client share one dictionary and one fallback rule, so a string rendered on
 * the server cannot disagree with the same string rendered in a client component beside
 * it — which is exactly the sort of split that makes a half-translated app look broken
 * rather than merely incomplete.
 */
export async function getT(): Promise<Translator> {
  return translatorFor(await getLocale());
}
