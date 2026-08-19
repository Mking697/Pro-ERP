import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { uploadAttachment, StorageUnavailableError } from "@/lib/storage";

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
    const { url, target } = await uploadAttachment({
      fileName: file.name,
      mimeType: file.type,
      buffer,
    });
    return NextResponse.json({ url, storedIn: target });
  } catch (error) {
    // The organization can act on this one, so it is a 400 with the reason, not a 500.
    if (error instanceof StorageUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error("[drive/upload] failed:", error);
    return NextResponse.json({ error: "File upload nahi ho payi." }, { status: 500 });
  }
}
