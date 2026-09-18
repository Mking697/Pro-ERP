import { put } from "@vercel/blob";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";

/** Every organization's attachments go to platform (Vercel Blob) storage — the same place
 * everything else in this app now lives (Neon Postgres, Vercel hosting), rather than
 * depending on each org's own Google Drive being connected and correctly shared. */
export type StorageTarget = "blob";

export interface UploadResult {
  url: string;
  target: StorageTarget;
}

export class StorageUnavailableError extends Error {}

function blobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function uploadToBlob(
  orgId: string,
  fileName: string,
  mimeType: string,
  buffer: Buffer
): Promise<UploadResult> {
  if (!blobConfigured()) {
    throw new StorageUnavailableError(
      "File storage abhi configure nahi hui hai. Platform administrator se kahein ki blob storage set karein."
    );
  }

  // Keyed by org so one tenant's uploads can never collide with or overwrite another's,
  // and a random id keeps two files of the same name apart.
  // The name comes from the uploader's machine. Vercel Blob treats a pathname as an
  // opaque key, so traversal is not known to be exploitable — but nothing here depends on
  // the original name being preserved exactly, and an untested assumption on a storage
  // path is not worth keeping.
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "file";
  const key = `orgs/${orgId}/${generateId("ATT")}-${safeName}`;

  const blob = await put(key, buffer, {
    access: "public",
    contentType: mimeType,
    addRandomSuffix: false,
  });

  return { url: blob.url, target: "blob" };
}

/** Stores one attachment for the current organization, in platform (Blob) storage. */
export async function uploadAttachment(input: {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<UploadResult> {
  const orgId = await getTenantOrgId();
  return uploadToBlob(orgId, input.fileName, input.mimeType, input.buffer);
}

/** Rasterised logos only — an SVG can carry script, and this renders on every page. */
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const MAX_LOGO_BYTES = 1024 * 1024;

export function isAllowedLogoType(mimeType: string): boolean {
  return LOGO_TYPES.includes(mimeType);
}

/**
 * Stores an organization's logo.
 *
 * Always platform storage, never the org's Drive: the logo renders in the header on
 * every page load, so it needs to come off a CDN without an auth round-trip. It is also
 * branding rather than business data, so the "your files stay in your Drive" promise
 * does not apply to it.
 *
 * Takes the org id explicitly because signup uploads a logo before any session exists.
 */
export async function uploadOrgLogo(
  orgId: string,
  input: { fileName: string; mimeType: string; buffer: Buffer }
): Promise<string> {
  if (!blobConfigured()) {
    throw new StorageUnavailableError(
      "Logo storage abhi configure nahi hui hai. Platform administrator se kahein."
    );
  }
  if (!isAllowedLogoType(input.mimeType)) {
    throw new StorageUnavailableError("Logo PNG, JPG ya WebP hona chahiye.");
  }
  if (input.buffer.byteLength > MAX_LOGO_BYTES) {
    throw new StorageUnavailableError("Logo 1MB se chhota hona chahiye.");
  }

  const ext = input.mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
  const blob = await put(`orgs/${orgId}/logo-${generateId("LOGO")}.${ext}`, input.buffer, {
    access: "public",
    contentType: input.mimeType,
    addRandomSuffix: false,
  });

  return blob.url;
}

/** Decodes a `data:image/png;base64,...` URL, the shape the signup form sends. */
export function decodeDataUrl(
  dataUrl: string
): { mimeType: string; buffer: Buffer } | null {
  const match = /^data:([a-z]+\/[a-z+.-]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  try {
    return { mimeType: match[1].toLowerCase(), buffer: Buffer.from(match[2], "base64") };
  } catch {
    return null;
  }
}
