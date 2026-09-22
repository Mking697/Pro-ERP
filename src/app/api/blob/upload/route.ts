import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireSession } from "@/lib/auth/guard";

/**
 * Authorizes a direct browser-to-Blob upload (see src/components/file-upload-field.tsx) —
 * replaces the old "POST the whole file through this serverless function" route
 * (`/api/drive/upload`, removed), which capped every attachment at Vercel's own ~4.5MB
 * function body limit regardless of what MAX_FILE_BYTES said. The file itself never
 * touches this route or this server; the browser uploads straight to Blob storage once
 * this handshake hands it a scoped, one-time token.
 */
const MAX_FILE_BYTES = 100 * 1024 * 1024;

const ALLOWED_MIME_PREFIXES = ["image/", "video/"];
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

/**
 * An SVG is markup, not a picture: it can carry `<script>`. Uploads are served with the
 * content type they claim from a public CDN URL, so an accepted SVG becomes a
 * script-executing page hosted under our own storage domain — a ready-made phishing page.
 * The `image/*` prefix below would otherwise let it back in (same reasoning as the old
 * `/api/drive/upload` route this replaces, and the org-logo path's own `isAllowedLogoType`).
 */
const DENIED_MIME_TYPES = ["image/svg+xml", "image/svg", "image/svg-xml"];

function isAllowedMimeType(mimeType: string): boolean {
  const type = mimeType.trim().toLowerCase();
  if (DENIED_MIME_TYPES.includes(type)) return false;
  return (
    ALLOWED_MIME_PREFIXES.some((prefix) => type.startsWith(prefix)) ||
    ALLOWED_MIME_TYPES.includes(type)
  );
}

export async function POST(request: Request) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        // The client sends the file's own MIME type as its payload (see
        // file-upload-field.tsx) — validated here before a token is even issued, and
        // then locked in as the ONLY content-type the resulting token permits
        // (`allowedContentTypes: [mimeType]`, not a wildcard), so a client can't request
        // a token claiming "image/png" and then actually upload something Blob would
        // otherwise accept under a broader "image/*" allowance, such as an SVG.
        const mimeType = (clientPayload ?? "").trim().toLowerCase();
        if (!isAllowedMimeType(mimeType)) {
          throw new Error("Sirf Image, Video, PDF, ya Excel files allowed hain.");
        }

        return {
          allowedContentTypes: [mimeType],
          maximumSizeInBytes: MAX_FILE_BYTES,
          addRandomSuffix: false,
        };
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload token nahi ban paya." },
      { status: 400 }
    );
  }
}
