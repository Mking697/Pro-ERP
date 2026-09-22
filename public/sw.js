/**
 * Minimal service worker: makes the app installable and gives a bare offline fallback.
 * Deliberately NOT a full offline-sync engine and NEVER caches API responses or HTML
 * pages — this is a data-heavy multi-tenant app where a real Postgres read replaced
 * `tenantCached`/`cached` specifically to kill up-to-30-second staleness bugs (a revoked
 * report-share link, a just-deactivated user, a just-created org). A service worker that
 * quietly re-served yesterday's /dashboard or /api/* response would reintroduce exactly
 * that class of bug, worse (indefinitely, not for 30s). See CLAUDE.md's "Caching removed"
 * note before changing this file's strategy.
 *
 * Strategy:
 *   - Hashed, immutable build assets (/_next/static/**) — cache-first. Safe because the
 *     filename itself changes on every new build; a stale cached copy can never be served
 *     under a live URL.
 *   - Everything else (every page, every /api/* call, every other request) — network
 *     only, no interception. A navigation request that fails outright (genuinely offline)
 *     falls back to the static /offline.html page, never to a cached copy of real data.
 */

const SHELL_CACHE = "pro-erp-shell-v1";
const OFFLINE_URL = "/offline.html";

// Precached once at install — static, org-agnostic assets only. No page, no API
// response, nothing that could ever go stale in a way that matters.
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

function isImmutableBuildAsset(url) {
  return url.origin === self.location.origin && url.pathname.startsWith("/_next/static/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // never touch a mutating request

  const url = new URL(request.url);

  // Hashed static build assets: cache-first, network fallback (also fills the cache
  // for next time). These never change under a given URL, so this can never go stale.
  if (isImmutableBuildAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
      )
    );
    return;
  }

  // A page navigation: always go to the network for the real, current page. Only on
  // an outright network failure (offline) does this fall back to the static offline
  // page — never to a cached copy of a previous response, which would be exactly the
  // stale-tenant-data regression this file's own header comment warns about.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // Everything else — every /api/* call, every other same-origin or cross-origin
  // request — passes straight through untouched. No interception, no caching.
});
