"use client";

import { useEffect } from "react";

/**
 * Registers the app-shell service worker (public/sw.js) once the page has loaded.
 *
 * Deliberately a no-op in dev — Turbopack's own HMR and a caching service worker fight
 * each other (a stale-cached chunk vs. a hot-reloaded one), and this app has no need to
 * exercise offline behavior while iterating locally. Production only.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Installability/offline-fallback is a nice-to-have, never something that
        // should surface as an error to a real user.
      });
    };

    // `window.load` frequently fires before this effect even runs — React hydration
    // happens after the page's own resources have finished loading, so by the time a
    // client component's effect subscribes, the event this was waiting for can already
    // be in the past, and a listener added after an event fires never sees it. Register
    // immediately whenever the document is already fully loaded; only fall back to the
    // "load" listener for the (rarer, above-the-fold-heavy) case where it genuinely
    // hasn't happened yet.
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
