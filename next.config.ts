import type { NextConfig } from "next";

/**
 * Response headers.
 *
 * There were none, which left the app framable — a clickjacking overlay over /admin/users
 * or /platform works when nothing forbids it — and gave a browser no instruction to keep
 * using HTTPS or to stop sniffing content types.
 *
 * Content-Security-Policy is deliberately sent as **Report-Only** for now. A wrong CSP
 * does not fail loudly; it silently stops a script or an image from loading in production,
 * and this policy has not been exercised in a real browser yet. Report-Only puts the
 * violations in the console where they can be read, and enforcing it is a one-word change
 * to the header name once a pass over every page comes back clean.
 *
 * `'unsafe-inline'` in script-src is required by the inline theme script in
 * src/app/layout.tsx, which has to run before first paint to stop a white flash. A nonce
 * would remove the need for it.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // Blob holds logos and attachments; Drive serves anything stored in an org's own folder.
  "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com https://drive.google.com https://*.googleusercontent.com",
  // next/font self-hosts, so no external font origin is needed.
  "font-src 'self' data:",
  "connect-src 'self' https://*.public.blob.vercel-storage.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          { key: "Content-Security-Policy-Report-Only", value: CSP },
        ],
      },
    ];
  },
};

export default nextConfig;
