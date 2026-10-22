import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { tenantFromOrgId, TenantResolutionError } from "@/lib/tenant";
import { uploadAttachmentForOrg, isAllowedAttachmentType, InvalidUploadError } from "@/lib/storage";

/**
 * Accepts a direct multipart upload from the browser and writes it to this server's own
 * local disk storage (src/lib/storage.ts). Replaces the old "hand the browser a scoped
 * Vercel Blob token, upload straight to Blob" flow (src/components/file-upload-field.tsx)
 * now that the app is self-hosted on a single VPS: there is no serverless function body
 * size ceiling to work around here, so the file can come straight through this route —
 * Nginx's own client_max_body_size is the only limit, matched below.
 */
const MAX_FILE_BYTES = 100 * 1024 * 1024;

// Use the same explicit type allowlist as the storage content validator. SVG/HTML and
// unsupported image/video subtypes never fall through a wildcard MIME prefix.

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
  if (!isAllowedAttachmentType(mimeType)) {
    return NextResponse.json(
      { error: "Sirf Image, Video, PDF, ya Excel files allowed hain." },
      { status: 400 }
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File bahut badi hai." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const { url } = await uploadAttachmentForOrg(tenant.orgId, {
      fileName: file.name || "file", mimeType, buffer,
    });
    return NextResponse.json({ url });
  } catch (error) {
    if (error instanceof InvalidUploadError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error; // A storage outage is not an invalid user file.
  }
}