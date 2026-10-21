/**
 * The public origin to build a shareable link against — e.g. for the Customer Portal
 * magic link. Deliberately reads the `X-Forwarded-Proto`/`X-Forwarded-Host` headers
 * (set by this deployment's own nginx reverse proxy, see `/etc/nginx/sites-enabled/
 * pro-erp`'s `proxy_set_header` lines) rather than `new URL(request.url).origin` —
 * behind nginx, `next start`'s own Request.url resolves to the internal
 * `http://localhost:<port>` the Node process is actually bound to, not the public
 * domain a visitor used, even though nginx correctly forwards the real `Host` header.
 * Falls back to the plain `Host` header (set correctly by this proxy too) and finally
 * to `request.url`'s own origin for local dev with no proxy in front at all.
 */
export function publicOriginFrom(request: Request): string {
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) return `${proto}://${host}`;
  return new URL(request.url).origin;
}
