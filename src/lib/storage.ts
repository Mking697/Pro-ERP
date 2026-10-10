import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";

/** Every organization's attachments go to local disk storage on the app server (under
 * UPLOADS_DIR, served back out at PUBLIC_UPLOADS_BASE_URL by Nginx) — the same place
 * everything else in this app now lives (self-hosted Postgres, self-hosted VPS), rather
 * than depending on each org's own Google Drive being connected and correctly shared. */
export type StorageTarget = "local";

export interface UploadResult {
  url: string;
  target: StorageTarget;
}

export class StorageUnavailableError extends Error {}

function uploadsDir(): string | null {
  return process.env.UPLOADS_DIR || null;
}

function publicBaseUrl(): string {
  // Falls back to a relative path (works behind any domain/Nginx) when unset.
  return (process.env.PUBLIC_UPLOADS_BASE_URL || "/uploads").replace(/\/$/, "");
}

function storageConfigured(): boolean {
  return Boolean(uploadsDir());
}

async function writeToLocalDisk(
  orgId: string,
  fileName: string,
  buffer: Buffer
): Promise<UploadResult> {
  const dir = uploadsDir();
  if (!dir) {
    throw new StorageUnavailableError(
      "File storage abhi configure nahi hui hai. Platform administrator se kahein ki storage set karein."
    );
  }

  // Keyed by org so one tenant's uploads can never collide with or overwrite another's,
  // and a random id keeps two files of the same name apart. The name comes from the
  // uploader's machine, so it is sanitized before ever touching a filesystem path.
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "file";
  const key = `orgs/${orgId}/${generateId("ATT")}-${safeName}`;

  const fullPath = join(dir, key);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, buffer);

  return { url: `${publicBaseUrl()}/${key}`, target: "local" };
}

/** Stores one attachment for the current organization, in platform (local disk) storage. */
export async function uploadAttachment(input: {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<UploadResult> {
  const orgId = await getTenantOrgId();
  return writeToLocalDisk(orgId, input.fileName, input.buffer);
}

/** Same as uploadAttachment, but for callers (e.g. the client-direct upload route) that
 * have already resolved the target org from the live session explicitly and must NOT
 * fall back to any ambient tenant context — see tests/sec05-blob-tenant.test.ts. */
export async function uploadAttachmentForOrg(
  orgId: string,
  input: { fileName: string; buffer: Buffer }
): Promise<UploadResult> {
  return writeToLocalDisk(orgId, input.fileName, input.buffer);
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
  if (!storageConfigured()) {
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
  const { url } = await writeToLocalDisk(orgId, `logo-${generateId("LOGO")}.${ext}`, input.buffer);
  return url;
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
