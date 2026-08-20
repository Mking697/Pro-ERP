import { EN } from "@/lib/i18n/en";
import type { Locale } from "@/lib/preferences";

/**
 * Translation, with the Hinglish string itself as the key.
 *
 * This codebase was written in Hinglish, so inventing a key namespace would mean touching
 * every string twice — once to name it, once to translate it — and would leave the source
 * reading a dotted key path where it used to say something a reviewer could check at a
 * glance. Using the source string as the key is the gettext approach: wrapping a string is
 * the whole migration.
 *
 * An untranslated string falls back to the Hinglish original rather than showing a missing
 * key. A half-translated screen is readable; `bom.form.title` on a button is not.
 */
export function translate(locale: Locale, source: string): string {
  if (locale === "hi") return source;
  return EN[source] ?? source;
}

export type Translator = (source: string) => string;

export function translatorFor(locale: Locale): Translator {
  return (source: string) => translate(locale, source);
}

/** How much of the wrapped surface actually has an English string, for reporting. */
export function translationCoverage(): { entries: number } {
  return { entries: Object.keys(EN).length };
}
