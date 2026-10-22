import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
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

// A validation failure is a client error, not a disk/registry outage. Extending the
// existing class also preserves the settings/logo route's 400 handling.
export class InvalidUploadError extends StorageUnavailableError {}

type AttachmentInput = { fileName: string; mimeType: string; buffer: Buffer };

// Explicit supported formats, never image/* or video/*. A matching MIME alone is
// attacker-controlled. Magic checks reject executable/HTML spoofing; this is format
// identification, NOT antivirus, full document validation or polyglot detection.
const ATTACHMENT_FORMATS = [
  { mime: "application/pdf", extensions: [".pdf"], matches: (b: Buffer) => /^%PDF-[12][.][0-9]$/.test(b.subarray(0, 8).toString("latin1")) && (b[8] === 10 || b[8] === 13) },
  { mime: "image/jpeg", extensions: [".jpg", ".jpeg"], matches: (b: Buffer) => hasMagic(b, "ffd8ff") },
  { mime: "image/png", extensions: [".png"], matches: (b: Buffer) => hasMagic(b, "89504e470d0a1a0a") },
  { mime: "image/webp", extensions: [".webp"], matches: (b: Buffer) => riff(b, "WEBP") },
  { mime: "image/gif", extensions: [".gif"], matches: (b: Buffer) => /^(GIF87a|GIF89a)$/.test(b.subarray(0, 6).toString("ascii")) },
  { mime: "image/bmp", extensions: [".bmp"], matches: (b: Buffer) => hasMagic(b, "424d") },
  { mime: "image/tiff", extensions: [".tif", ".tiff"], matches: (b: Buffer) => hasMagic(b, "49492a00") || hasMagic(b, "4d4d002a") },
  { mime: "video/mp4", extensions: [".mp4", ".m4v"], matches: (b: Buffer) => isoVideo(b) },
  { mime: "video/quicktime", extensions: [".mov"], matches: (b: Buffer) => isoVideo(b) && b.subarray(8, 12).toString("ascii") === "qt  " },
  { mime: "video/webm", extensions: [".webm"], matches: (b: Buffer) => hasMagic(b, "1a45dfa3") && b.subarray(0, 256).includes(Buffer.from("webm")) },
  { mime: "video/x-msvideo", extensions: [".avi"], matches: (b: Buffer) => riff(b, "AVI ") },
  { mime: "video/mpeg", extensions: [".mpg", ".mpeg"], matches: (b: Buffer) => hasMagic(b, "000001ba") || hasMagic(b, "000001b3") },
  { mime: "video/ogg", extensions: [".ogv", ".ogg"], matches: (b: Buffer) => hasMagic(b, "4f676753") },
  { mime: "application/vnd.ms-excel", extensions: [".xls"], matches: (b: Buffer) => hasMagic(b, "d0cf11e0a1b11ae1") },
  // ZIP alone could be any archive: XLSX must also identify its workbook parts.
  { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extensions: [".xlsx"], matches: (b: Buffer) => hasMagic(b, "504b0304") && b.includes(Buffer.from("[Content_Types].xml")) && b.includes(Buffer.from("xl/workbook.xml")) },
];
function hasMagic(buffer: Buffer, hex: string): boolean {
  const signature = Buffer.from(hex, "hex");
  return buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature);
}
function riff(buffer: Buffer, format: string): boolean {
  return buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === format;
}
function isoVideo(buffer: Buffer): boolean {
  return buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp" &&
    ["isom", "iso2", "mp41", "mp42", "avc1", "M4V ", "qt  ", "3gp4", "3gp5"].includes(buffer.subarray(8, 12).toString("ascii"));
}
export function isAllowedAttachmentType(mimeType: string): boolean {
  return ATTACHMENT_FORMATS.some((format) => format.mime === mimeType.trim().toLowerCase());
}
function validateAttachment({ fileName, mimeType, buffer }: AttachmentInput): void {
  const extension = extname(fileName).toLowerCase();
  const type = mimeType.trim().toLowerCase();
  if (!ATTACHMENT_FORMATS.some((format) => format.mime === type && format.extensions.includes(extension) && format.matches(buffer))) {
    throw new InvalidUploadError("File content, MIME type aur extension match nahi karte ya format allowed nahi hai.");
  }
}

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
  buffer: Buffer,
  mimeType: string
): Promise<UploadResult> {
  validateAttachment({ fileName, mimeType, buffer });
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
  return writeToLocalDisk(orgId, input.fileName, input.buffer, input.mimeType);
}

/** Same as uploadAttachment, but for callers (e.g. the client-direct upload route) that
 * have already resolved the target org from the live session explicitly and must NOT
 * fall back to any ambient tenant context — see tests/sec05-blob-tenant.test.ts. */
export async function uploadAttachmentForOrg(
  orgId: string,
  input: AttachmentInput
): Promise<UploadResult> {
  return writeToLocalDisk(orgId, input.fileName, input.buffer, input.mimeType);
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
  const { url } = await writeToLocalDisk(orgId, `logo-${generateId("LOGO")}.${ext}`, input.buffer, input.mimeType);
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
