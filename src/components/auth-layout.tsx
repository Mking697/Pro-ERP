import Image from "next/image";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface AuthFeature {
  icon: LucideIcon;
  label: string;
}

/**
 * Shared shell for the pre-login pages (Login, Signup).
 *
 * There is no signed-in org yet at this point, so this renders Pro ERP's own product
 * identity, never an org's logo — the org-branded logo (Module 10) only exists once a
 * tenant is resolved, well after this page.
 */
export default function AuthLayout({
  tagline,
  features,
  children,
}: {
  tagline: string;
  features: AuthFeature[];
  children: ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4 sm:p-6 lg:p-10">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_55%_at_50%_-10%,color-mix(in_oklch,var(--primary)_16%,transparent),transparent)]" />
        <div className="absolute -top-24 -left-24 size-[26rem] rounded-full bg-[color-mix(in_oklch,var(--primary)_12%,transparent)] blur-3xl" />
        <div className="absolute -right-24 bottom-0 size-[22rem] rounded-full bg-[color-mix(in_oklch,var(--primary)_10%,transparent)] blur-3xl" />
        <div
          className="absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_10%,black,transparent)] dark:opacity-25"
          style={{
            backgroundImage:
              "radial-gradient(color-mix(in_oklch,var(--foreground)_18%,transparent) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
      </div>

      <div className="grid w-full max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div className="hidden animate-in fade-in-0 slide-in-from-left-6 duration-700 lg:flex lg:flex-col lg:gap-8">
          <div className="flex items-center gap-3">
            <Image
              src="/icon-192.png"
              alt=""
              width={44}
              height={44}
              className="rounded-xl shadow-sm shadow-primary/20 ring-1 ring-foreground/10"
            />
            <span className="font-heading text-xl font-semibold tracking-tight">
              Pro ERP
            </span>
          </div>
          <p className="max-w-sm text-lg text-muted-foreground text-balance">
            {tagline}
          </p>
          <ul className="grid gap-3">
            {features.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card/40 px-4 py-3 text-sm text-foreground shadow-sm backdrop-blur-sm transition-colors duration-200 hover:border-primary/30 hover:bg-card/70"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="size-4" />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex animate-in fade-in-0 slide-in-from-bottom-4 flex-col items-center gap-6 duration-500 lg:items-stretch">
          <div className="flex items-center gap-2 lg:hidden">
            <Image
              src="/icon-192.png"
              alt=""
              width={32}
              height={32}
              className="rounded-lg"
            />
            <span className="font-heading text-lg font-semibold tracking-tight">
              Pro ERP
            </span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
