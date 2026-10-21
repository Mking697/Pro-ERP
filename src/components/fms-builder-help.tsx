"use client";

import { useRef, useSyncExternalStore } from "react";
import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/components/preferences-provider";

const SEEN_KEY = "pro-erp-fms-builder-help-seen";

/**
 * Same localStorage-backed "seen" pattern as src/components/changelog-menu.tsx's own
 * SEEN_KEY/useSyncExternalStore — a tiny external store instead of useState+useEffect,
 * since localStorage has no React state of its own and writing it from a click handler
 * still has to notify this component, and this sidesteps the SSR/hydration mismatch a
 * plain useState would have (the server snapshot is always "not seen yet").
 */
let cachedSeen: boolean | undefined;
const listeners = new Set<() => void>();

function readSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false; // Private window / blocked storage: behave as "never seen".
  }
}

function getSnapshot(): boolean | undefined {
  if (cachedSeen === undefined) cachedSeen = readSeen();
  return cachedSeen;
}

function getServerSnapshot(): boolean | undefined {
  return undefined;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function markSeen() {
  cachedSeen = true;
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Worst case the tour re-opens next visit — not a correctness bug.
  }
  for (const listener of listeners) listener();
}

/**
 * A plain-language "what does each box do" explainer for the FMS Template Builder — this
 * product's own standout feature, and also its most intimidating form. Copy here is
 * adapted from the Guidebook's own "Naya FMS Template banana" / "Building a new FMS
 * Template" chapter (src/lib/guide.ts / src/lib/guide.en.ts, section id "fms-template")
 * rather than written fresh, so the explanation given here and the one a non-technical
 * user finds at /guide stay the same story.
 *
 * Opens itself once automatically the first time a user reaches the builder (tracked in
 * localStorage, never again after that) and can always be reopened with the "? Help"
 * button — same "seen once, always reachable" shape as the changelog bell.
 */
export default function FmsBuilderHelp() {
  const t = useT();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const seen = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // `undefined` is the not-yet-hydrated snapshot — stay closed until the real, client-only
  // value arrives, so this never force-opens during SSR/first paint.
  const open = seen === false;

  function close() {
    markSeen();
  }

  return (
    <>
      <Button
        type="button"
        ref={triggerRef}
        aria-haspopup="dialog"
        aria-expanded={open}
        variant="ghost"
        size="icon-sm"
        aria-label={t("Builder ke baare me madad")}
        onClick={() => {
          cachedSeen = false;
          for (const listener of listeners) listener();
        }}
      >
        <HelpCircle aria-hidden="true" />
      </Button>

      <Dialog open={open === true} onOpenChange={(v) => { if (!v) close(); }}>
        <DialogContent finalFocus={triggerRef} className="max-h-[80vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("FMS Template Builder kaise kaam karta hai")}</DialogTitle>
            <DialogDescription>
              {t("Ek multi-step process ko ek baar define karna — phir wo baar-baar chal sakta hai.")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            <section className="space-y-1">
              <p className="font-medium">{t("Steps: naam, Assigned To, TAT")}</p>
              <p className="text-muted-foreground">
                {t(
                  "Har step ka naam, kise assign hoga, aur TAT (Minutes, Hours ya Days me) bharein — yahi decide karta hai kaam kiske paas jaayega aur kab tak."
                )}
              </p>
            </section>

            <section className="space-y-1">
              <p className="font-medium">{t("Outcome Type aur Next Step")}</p>
              <p className="text-muted-foreground">
                {t(
                  "Step ka Outcome Type chunein — Done, Pass aur Fail, Pass/Fail/Scrap Qty, Number, Text, Attachment, ya Custom (khud outcomes typing karein). Phir har outcome ke aage decide karein agla kaunsa step chalega, ya FMS yahin khatam ho."
                )}
              </p>
            </section>

            <section className="space-y-1">
              <p className="font-medium">{t("Trigger — MANUAL ya automatic")}</p>
              <p className="text-muted-foreground">
                {t(
                  "Trigger \"MANUAL\" rakhne par FMS sirf haath se start hota hai. Iski jagah kisi module ka event key (jaise INWARD_ENTRY_CREATED) ya kisi doosre FMS template ka outcome key dene se wo FMS uske hote hi khud shuru ho jaata hai — koi loop na bane iska dhyan template banate waqt khud rakhna hai."
                )}
              </p>
            </section>

            <section className="space-y-1">
              <p className="font-medium">{t("Deadline kisi pehle step ke field se")}</p>
              <p className="text-muted-foreground">
                {t(
                  "Kisi bhi step ki deadline TAT box me fix number likhne ke bajaye kisi pehle step ke field se bhi nikal sakti hai — \"Deadline pichle step ke field se nikaale\" tick karke us step aur field ko chunein, aur ek offset (+/-) daalein."
                )}
              </p>
            </section>

            <section className="space-y-1">
              <p className="font-medium">{t("Form fields aur Existing FMS data")}</p>
              <p className="text-muted-foreground">
                {t(
                  "Ek step apna khud ka Form bhar sakta hai, ya kisi doosre module/step se reference data khinch sakta hai (Existing FMS) — dono independent hain, ek step dono ek saath bhi use kar sakta hai."
                )}
              </p>
            </section>

            <section className="space-y-1">
              <p className="font-medium">{t("Archive aur Delete")}</p>
              <p className="text-muted-foreground">
                {t(
                  "Template Archive karne se uske purane chal rahe steps par asar nahi padta, sirf naye instance us se nahi bante. Ek Archived template jise koi step abhi chala hi nahi raha, use Templates list se permanently Delete bhi kiya ja sakta hai."
                )}
              </p>
            </section>
          </div>

          <DialogFooter>
            <Button onClick={close}>{t("Samajh gaya")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
