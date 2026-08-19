import { google, drive_v3 } from "googleapis";
import { Readable } from "stream";
import { getGoogleAuthClient } from "@/lib/googleAuth";

let cachedClient: drive_v3.Drive | null = null;

function getDriveClient(): drive_v3.Drive {
  if (!cachedClient) {
    cachedClient = google.drive({ version: "v3", auth: getGoogleAuthClient() });
  }
  return cachedClient;
}

interface UploadFileInput {
  folderId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}

/** Uploads a file into the given Drive folder and makes it viewable by anyone with the link. */
export async function uploadFileToDrive(input: UploadFileInput): Promise<string> {
  const drive = getDriveClient();

  const created = await drive.files.create({
    requestBody: {
      name: input.fileName,
      parents: [input.folderId],
    },
    media: {
      mimeType: input.mimeType,
      body: Readable.from(input.buffer),
    },
    fields: "id",
  });

  const fileId = created.data.id;
  if (!fileId) {
    throw new Error("Drive upload failed.");
  }

  await drive.permissions.create({
    fileId,
    requestBody: { role: "reader", type: "anyone" },
  });

  const file = await drive.files.get({ fileId, fields: "webViewLink" });
  if (!file.data.webViewLink) {
    throw new Error("Drive upload succeeded but no link was returned.");
  }

  return file.data.webViewLink;
}

export interface FolderCheck {
  ok: boolean;
  /** Why uploads into this folder will fail, phrased for the admin connecting it. */
  reason?: string;
}

/**
 * Verifies the folder can actually receive an upload, by performing one.
 *
 * Seeing a folder is not the same as being able to write a file into it: a service
 * account owns whatever it uploads and has no Drive storage quota of its own, so any
 * folder in a personal My Drive accepts the sharing but rejects every upload. Checking
 * only visibility means the organization passes setup and discovers the problem later,
 * when someone tries to attach a file to a task and gets an error they cannot place.
 */
export async function verifyDriveFolderWritable(folderId: string): Promise<FolderCheck> {
  const drive = getDriveClient();

  try {
    const meta = await drive.files.get({ fileId: folderId, fields: "id, mimeType" });
    if (meta.data.mimeType !== "application/vnd.google-apps.folder") {
      return { ok: false, reason: "Ye link kisi folder ka nahi hai." };
    }
  } catch {
    return {
      ok: false,
      reason:
        "Is folder tak access nahi mil paya. Folder ko service account email ke saath Editor access se share karein.",
    };
  }

  let probeId: string | undefined;
  try {
    const probe = await drive.files.create({
      requestBody: { name: ".proerp-write-check", parents: [folderId] },
      media: { mimeType: "text/plain", body: Readable.from(Buffer.from("ok")) },
      fields: "id",
      supportsAllDrives: true,
    });
    probeId = probe.data.id ?? undefined;
    return { ok: true };
  } catch (error) {
    const message =
      (error as { errors?: { message?: string }[] })?.errors?.[0]?.message ??
      (error as Error)?.message ??
      "";

    if (message.includes("storage quota")) {
      return {
        ok: false,
        reason:
          "Ye folder ek personal Google Drive me hai. Service account personal Drive me file nahi rakh sakta (Google ki limitation), isliye attachments yahan upload nahi honge. Folder ko ek Shared Drive ke andar banayein aur service account ko Content Manager access dein.",
      };
    }
    return { ok: false, reason: message || "Is folder me file upload nahi ho payi." };
  } finally {
    if (probeId) {
      await drive.files
        .delete({ fileId: probeId, supportsAllDrives: true })
        .catch(() => undefined);
    }
  }
}

/** Verifies the service account can see a folder (and that it is actually a folder). */
export async function verifyDriveFolderAccess(folderId: string): Promise<boolean> {
  try {
    const drive = getDriveClient();
    const res = await drive.files.get({ fileId: folderId, fields: "id, mimeType" });
    return res.data.mimeType === "application/vnd.google-apps.folder";
  } catch {
    return false;
  }
}
