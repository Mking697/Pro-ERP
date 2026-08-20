"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ACCENT_COOKIE,
  LOCALE_COOKIE,
  PREF_MAX_AGE,
  THEME_COOKIE,
  type Accent,
  type Locale,
  type ThemeMode,
} from "@/lib/preferences";
import { translatorFor, type Translator } from "@/lib/i18n";

interface PreferencesValue {
  mode: ThemeMode;
  accent: Accent;
  locale: Locale;
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: Accent) => void;
  setLocale: (locale: Locale) => void;
  /** Translate a Hinglish source string for the active locale. */
  t: Translator;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

function writeCookie(name: string, value: string) {
  // Not httpOnly and not secret: the server needs it to render the right theme on the
  // first paint, and the browser needs it to apply a change without a round trip.
  document.cookie = `${name}=${value}; path=/; max-age=${PREF_MAX_AGE}; samesite=lax`;
}

export default function PreferencesProvider({
  mode,
  accent,
  locale,
  children,
}: {
  mode: ThemeMode;
  accent: Accent;
  locale: Locale;
  children: React.ReactNode;
}) {
  const router = useRouter();

  const apply = useCallback(
    (name: string, value: string, immediate?: () => void) => {
      writeCookie(name, value);
      // Paint the change now, then re-render the server tree so server-rendered strings
      // and the html attributes agree with it. Waiting only for the refresh would leave
      // the menu feeling unresponsive for the length of a round trip.
      immediate?.();
      router.refresh();
    },
    [router]
  );

  // Memoised on locale alone. If `t` changed identity whenever the theme changed, every
  // effect that lists it as a dependency would refetch its data on a colour switch.
  const t = useMemo(() => translatorFor(locale), [locale]);

  const value = useMemo<PreferencesValue>(
    () => ({
      mode,
      accent,
      locale,
      t,
      setMode: (next) =>
        apply(THEME_COOKIE, next, () => {
          const root = document.documentElement;
          const dark =
            next === "dark" ||
            (next === "system" &&
              window.matchMedia("(prefers-color-scheme: dark)").matches);
          root.classList.toggle("dark", dark);
        }),
      setAccent: (next) =>
        apply(ACCENT_COOKIE, next, () => {
          document.documentElement.dataset.accent = next;
        }),
      setLocale: (next) => apply(LOCALE_COOKIE, next),
    }),
    [mode, accent, locale, t, apply]
  );

  return (
    <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) {
    throw new Error("usePreferences must be used inside PreferencesProvider");
  }
  return ctx;
}

/** The translator on its own, for components that only need strings. */
export function useT(): Translator {
  return usePreferences().t;
}
