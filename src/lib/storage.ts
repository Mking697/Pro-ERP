import { put } from "@vercel/blob";
import { getSetting } from "@/lib/settings";
import { extractDriveFolderId } from "@/lib/sheetUrl";
import { uploadFileToDrive } from "@/lib/googleDrive";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";

/**
 * Where an organization's attachments go.
 *
 * Two kinds of customer exist and both have to work. An organization on Google
 * Workspace can connect a Shared Drive folder and keep its files in its own Drive.
 * An organization on a free Gmail account cannot: a service account owns whatever it
 * uploads and has no Drive storage quota, so any folder in a personal My Drive rejects
 * every upload. Requiring a Shared Drive would leave those customers without
 * attachments entirely, so platform storage is the floor that always works and Drive is
 * the upgrade for those who can use it.
 */
export type StorageTarget = "drive" | "blob";

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
      "File storage abhi configure nahi hui hai. Admin > Settings me apna Drive folder connect karein, ya platform administrator se kahein ki blob storage set karein."
    );
  }

  // Keyed by org so one tenant's uploads can never collide with or overwrite another's,
  // and a random id keeps two files of the same name apart.
  const key = `orgs/${orgId}/${generateId("ATT")}-${fileName}`;

  const blob = await put(key, buffer, {
    access: "public",
    contentType: mimeType,
    addRandomSuffix: false,
  });

  return { url: blob.url, target: "blob" };
}

/**
 * Stores one attachment for the current organization.
 *
 * Prefers the org's own Drive folder when one is connected. A Drive failure falls
 * through to platform storage rather than losing the user's file — the person
 * attaching it cannot fix a Drive misconfiguration mid-task.
 */
export async function uploadAttachment(input: {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<UploadResult> {
  const orgId = await getTenantOrgId();
  const folderUrl = await getSetting("DRIVE_FOLDER_URL");
  const folderId = folderUrl ? extractDriveFolderId(folderUrl) : null;

  if (folderId) {
    try {
      const url = await uploadFileToDrive({
        folderId,
        fileName: input.fileName,
        mimeType: input.mimeType,
        buffer: input.buffer,
      });
      return { url, target: "drive" };
    } catch (error) {
      const reason =
        (error as { errors?: { message?: string }[] })?.errors?.[0]?.message ??
        (error as Error)?.message ??
        "";
      console.error(`[storage] Drive upload failed for org ${orgId}, using blob:`, reason);

      if (!blobConfigured()) {
        throw new StorageUnavailableError(
          reason.includes("storage quota")
            ? "Ye Drive folder ek personal Google Drive me hai, isliye file upload nahi ho sakti. Folder ko Shared Drive me banayein, ya platform administrator se blob storage set karwayein."
            : `Drive me file upload nahi ho payi: ${reason}`
        );
      }
    }
  }

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
