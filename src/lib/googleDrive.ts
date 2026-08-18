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
