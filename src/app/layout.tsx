import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import PreferencesProvider from "@/components/preferences-provider";
import {
  ACCENT_COOKIE,
  LOCALE_COOKIE,
  THEME_COOKIE,
  parseAccent,
  parseLocale,
  parseThemeMode,
} from "@/lib/preferences";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pro ERP",
  description: "Custom ERP powered by Google Sheets & Drive",
};

/**
 * Resolves "system" before the first paint.
 *
 * The server knows the chosen mode but not the operating system's preference, so a
 * "system" reader would get a light page that turns dark a frame later. This runs
 * synchronously in the head — early enough that the flash never happens — and does
 * nothing at all for an explicit light or dark choice.
 */
const SYSTEM_THEME_SCRIPT = `try{if(document.documentElement.dataset.mode==='system'&&matchMedia('(prefers-color-scheme: dark)').matches){document.documentElement.classList.add('dark')}}catch(e){}`;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const cookieStore = await cookies();
  const mode = parseThemeMode(cookieStore.get(THEME_COOKIE)?.value);
  const accent = parseAccent(cookieStore.get(ACCENT_COOKIE)?.value);
  const locale = parseLocale(cookieStore.get(LOCALE_COOKIE)?.value);

  return (
    <html
      lang={locale === "hi" ? "hi-Latn" : "en"}
      data-mode={mode}
      data-accent={accent}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased${
        mode === "dark" ? " dark" : ""
      }`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: SYSTEM_THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <PreferencesProvider mode={mode} accent={accent} locale={locale}>
          {children}
          <Toaster />
        </PreferencesProvider>
      </body>
    </html>
  );
}
