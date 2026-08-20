"use client";

import Link from "next/link";
import { Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/empty-state";
import { useT } from "@/components/preferences-provider";

/**
 * A board's stand-in when the sheet it reads from has not been connected yet.
 *
 * Six boards each had their own copy of this. It is the first thing a brand-new
 * organization sees on most screens, so it names the sheet that is missing and links
 * straight to where it gets connected, rather than reporting an error the reader cannot
 * act on.
 */
export default function SheetNotConnected({
  what,
  hint,
}: {
  /** The sheet's own label, as it appears in Settings. */
  what: string;
  hint?: string;
}) {
  const t = useT();
  return (
    <EmptyState
      icon={<Unplug />}
      title={`"${what}" sheet connect nahi hui`}
      description={
        hint ??
        t("Ye page usi sheet se padhta hai. Settings me uska URL paste karte hi yahan data aane lagega.")
      }
      action={
        <Button
          variant="outline"
          size="sm"
          render={<Link href="/admin/settings">{t("Settings kholein")}</Link>}
        />
      }
    />
  );
}
