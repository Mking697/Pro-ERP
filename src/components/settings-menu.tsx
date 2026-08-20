"use client";

import { Check, Languages, Monitor, Moon, Palette, Settings2, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ACCENTS,
  ACCENT_LABELS,
  LOCALES,
  LOCALE_LABELS,
  THEME_MODES,
  type Accent,
  type Locale,
  type ThemeMode,
} from "@/lib/preferences";
import { usePreferences } from "@/components/preferences-provider";

const MODE_ICON = {
  system: Monitor,
  light: Sun,
  dark: Moon,
} as const;

const MODE_LABEL: Record<ThemeMode, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

/** The swatch beside each accent, so the colour is picked by sight, not by its name. */
const SWATCH: Record<Accent, string> = {
  neutral: "bg-foreground",
  blue: "bg-[oklch(0.55_0.18_258)]",
  green: "bg-[oklch(0.52_0.13_158)]",
  violet: "bg-[oklch(0.53_0.2_292)]",
  amber: "bg-[oklch(0.72_0.16_70)]",
};

/**
 * Theme and language, in the header of every signed-in page.
 *
 * Both are display preferences that belong to the person, not to the organization, so
 * this sits next to their own name rather than inside the Admin section — a doer who
 * never sees Settings can still switch the app to English or turn the lights down.
 */
export default function SettingsMenu() {
  const { mode, accent, locale, setMode, setAccent, setLocale, t } = usePreferences();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={t("Settings")}>
            <Settings2 />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-2">
            <Palette className="size-3.5" />
            {t("Theme")}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as ThemeMode)}
          >
            {THEME_MODES.map((m) => {
              const Icon = MODE_ICON[m];
              return (
                <DropdownMenuRadioItem key={m} value={m}>
                  <Icon className="size-4" />
                  {MODE_LABEL[m]}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("Colour")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={accent}
            onValueChange={(v) => setAccent(v as Accent)}
          >
            {ACCENTS.map((a) => (
              <DropdownMenuRadioItem key={a} value={a}>
                <span
                  aria-hidden="true"
                  className={`size-3.5 shrink-0 rounded-full ${SWATCH[a]}`}
                />
                {ACCENT_LABELS[a]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-2">
            <Languages className="size-3.5" />
            {t("Language")}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={locale}
            onValueChange={(v) => setLocale(v as Locale)}
          >
            {LOCALES.map((l) => (
              <DropdownMenuRadioItem key={l} value={l}>
                {locale === l ? (
                  <Check className="size-4" />
                ) : (
                  <span aria-hidden="true" className="size-4" />
                )}
                {LOCALE_LABELS[l]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
