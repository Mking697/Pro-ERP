import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { tenantFromOrgId, TenantResolutionError } from "@/lib/tenant";
import { uploadAttachmentForOrg } from "@/lib/storage";

/**
 * Accepts a direct multipart upload from the browser and writes it to this server's own
 * local disk storage (src/lib/storage.ts). Replaces the old "hand the browser a scoped
 * Vercel Blob token, upload straight to Blob" flow (src/components/file-upload-field.tsx)
 * now that the app is self-hosted on a single VPS: there is no serverless function body
 * size ceiling to work around here, so the file can come straight through this route —
 * Nginx's own client_max_body_size is the only limit, matched below.
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
 * content type they claim from a public URL under our own domain, so an accepted SVG
 * becomes a script-executing page hosted under our own storage path — a ready-made
 * phishing page. The `image/*` prefix below would otherwise let it back in.
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

  // Resolve from the validated session explicitly, never ambient tenant context or
  // client input — match module guards' live organization/trial policy before any
  // bytes are written to disk.
  let tenant;
  try {
    tenant = await tenantFromOrgId(guard.session.orgId);
  } catch (error) {
    if (error instanceof TenantResolutionError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error; // Registry outages fail closed, not as an authorization success.
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload request." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Koi file nahi mili." }, { status: 400 });
  }

  const mimeType = (file.type || "").trim().toLowerCase();
  if (!isAllowedMimeType(mimeType)) {
    return NextResponse.json(
      { error: "Sirf Image, Video, PDF, ya Excel files allowed hain." },
      { status: 400 }
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File bahut badi hai." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { url } = await uploadAttachmentForOrg(tenant.orgId, {
    fileName: file.name || "file",
    buffer,
  });

  return NextResponse.json({ url });
}