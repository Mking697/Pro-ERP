"use client";

import React from "react";
import Link from "next/link";
import { useT } from "@/components/preferences-provider";

export default function PrintActions() {
  const t = useT();
  return <nav className="flex flex-wrap gap-4 print:hidden" aria-label={t("Saved snapshot actions")}>
    <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => window.print()}>{t("Print saved snapshot")}</button>
    <Link className="self-center underline" href="/job-cost-sheets">{t("Job Cost Sheets")}</Link>
  </nav>;
}
