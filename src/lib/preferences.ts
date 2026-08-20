/**
 * Per-person display preferences: colour theme and language.
 *
 * Both live in plain (non-httpOnly) cookies rather than the Users sheet. They are read on
 * every single render, and a sheet round trip costs hundreds of milliseconds against a
 * quota shared by every tenant — a person's choice of theme is not worth that. Cookies
 * also let the server render the right theme on the first paint, so the page never flashes
 * white before turning dark.
 */

export const THEME_COOKIE = "erp_theme";
export const ACCENT_COOKIE = "erp_accent";
export const LOCALE_COOKIE = "erp_locale";

/** A year: preferences should outlive a session without being permanent. */
export const PREF_MAX_AGE = 60 * 60 * 24 * 365;

export const THEME_MODES = ["system", "light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const ACCENTS = ["neutral", "blue", "green", "violet", "amber"] as const;
export type Accent = (typeof ACCENTS)[number];

export const LOCALES = ["en", "hi"] as const;
export type Locale = (typeof LOCALES)[number];

/** English is the default, as asked — Hinglish is the opt-in. */
export const DEFAULT_LOCALE: Locale = "en";
export const DEFAULT_MODE: ThemeMode = "system";
export const DEFAULT_ACCENT: Accent = "neutral";

export function parseThemeMode(raw: string | undefined | null): ThemeMode {
  return THEME_MODES.includes(raw as ThemeMode) ? (raw as ThemeMode) : DEFAULT_MODE;
}

export function parseAccent(raw: string | undefined | null): Accent {
  return ACCENTS.includes(raw as Accent) ? (raw as Accent) : DEFAULT_ACCENT;
}

export function parseLocale(raw: string | undefined | null): Locale {
  return LOCALES.includes(raw as Locale) ? (raw as Locale) : DEFAULT_LOCALE;
}

export const ACCENT_LABELS: Record<Accent, string> = {
  neutral: "Neutral",
  blue: "Blue",
  green: "Green",
  violet: "Violet",
  amber: "Amber",
};

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  hi: "Hinglish",
};
