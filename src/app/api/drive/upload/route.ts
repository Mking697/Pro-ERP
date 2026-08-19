import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { getSetting } from "@/lib/settings";
import { extractDriveFolderId } from "@/lib/sheetUrl";
import { uploadFileToDrive } from "@/lib/googleDrive";

// Vercel's Hobby-tier serverless functions cap the request body around 4.5MB,
// so we enforce a slightly smaller limit here to fail with a clear message instead of a platform 413.
const MAX_FILE_BYTES = 4 * 1024 * 1024;

const ALLOWED_MIME_PREFIXES = ["image/", "video/"];
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

function isAllowedMimeType(mimeType: string): boolean {
  return (
    ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix)) ||
    ALLOWED_MIME_TYPES.includes(mimeType)
  );
}

export async function POST(request: Request) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const folderUrl = await getSetting("DRIVE_FOLDER_URL");
  const folderId = folderUrl ? extractDriveFolderId(folderUrl) : null;
  if (!folderId) {
    return NextResponse.json(
      { error: "Drive folder abhi configure nahi hua hai. Admin > Settings me jaake configure karein." },
      { status: 400 }
    );
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Koi file nahi mili." }, { status: 400 });
  }

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `File ${MAX_FILE_BYTES / (1024 * 1024)}MB se chhoti honi chahiye.` },
      { status: 400 }
    );
  }

  if (!isAllowedMimeType(file.type)) {
    return NextResponse.json(
      { error: "Sirf Image, Video, PDF, ya Excel files allowed hain." },
      { status: 400 }
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await uploadFileToDrive({
      folderId,
      fileName: file.name,
      mimeType: file.type,
      buffer,
    });
    return NextResponse.json({ url });
  } catch (error) {
    const reason =
      (error as { errors?: { message?: string }[] })?.errors?.[0]?.message ??
      (error as Error)?.message ??
      "";

    // Google's own wording here is unhelpful to an admin, and this is the one failure
    // an organization can actually fix themselves, so name the cause and the remedy.
    if (reason.includes("storage quota")) {
      return NextResponse.json(
        {
          error:
            "Ye folder ek personal Google Drive me hai, aur service account personal Drive me file nahi rakh sakta (Google ki limitation). Folder ko ek Shared Drive me banayein aur wahan service account ko Content Manager access dein.",
        },
        { status: 400 }
      );
    }

    console.error("[drive/upload] failed:", reason || error);
    return NextResponse.json(
      { error: reason ? `File upload nahi ho payi: ${reason}` : "File upload nahi ho payi." },
      { status: 500 }
    );
  }
}
