import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => "ORG-security-upload", tenantFromOrgId: async (orgId: string) => ({ orgId }), TenantResolutionError: class extends Error {} }));
vi.mock("@/lib/auth/guard", () => ({ requireSession: async () => ({ ok: true, session: { orgId: "ORG-security-upload" } }) }));
import { uploadAttachment, uploadAttachmentForOrg, uploadOrgLogo } from "@/lib/storage";
import { POST } from "@/app/api/blob/upload/route";

let directory: string;
beforeEach(async () => {
  const scratch = join(homedir(), "AppData", "Local", "hermes", "cache", "scratch");
  await mkdir(scratch, { recursive: true });
  directory = await mkdtemp(join(scratch, "security-upload-"));
  vi.stubEnv("UPLOADS_DIR", directory);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe("attachment content validation before disk writes", () => {
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  it("preserves PNG attachments and PNG/WebP logos", async () => {
    const stored = await uploadAttachment({ fileName: "image.png", mimeType: "image/png", buffer: png });
    expect(stored.target).toBe("local");
    const files = await readdir(join(directory, "orgs", "ORG-security-upload"));
    expect(await readFile(join(directory, "orgs", "ORG-security-upload", files[0]))).toEqual(png);
    await expect(uploadOrgLogo("ORG-security-upload", { fileName: "logo.png", mimeType: "image/png", buffer: png })).resolves.toContain("/uploads/");
    await expect(uploadOrgLogo("ORG-security-upload", { fileName: "logo.webp", mimeType: "image/webp", buffer: Buffer.from("52494646180000005745425056503820", "hex") })).resolves.toContain("/uploads/");
  });
  it.each([
    ["bad.png", "image/png", Buffer.from("<html><script>alert(1)</script></html>")],
    ["bad.jpg", "image/jpeg", Buffer.from("%PDF-1.7\nnot a jpeg")],
    ["bad.exe", "application/pdf", Buffer.from("%PDF-1.7\nnot an exe")],
    ["bad.pdf", "image/jpeg", Buffer.from("ffd8ff", "hex")],
  ])("rejects content/MIME/extension disagreement %s", async (fileName, mimeType, buffer) => {
    await expect(uploadAttachmentForOrg("ORG-security-upload", { fileName, mimeType, buffer })).rejects.toThrow(/file content/i);
    expect(await readdir(directory)).toEqual([]);
  });
  it("the actual multipart route rejects spoofed content with 400 and accepts PNG", async () => {
    const form = new FormData(); form.set("file", new File(["MZ executable"], "evil.pdf", { type: "application/pdf" }));
    const rejected = await POST(new Request("https://test.invalid/api/blob/upload", { method: "POST", body: form }));
    expect(rejected.status).toBe(400);
    expect(await readdir(directory)).toEqual([]);
    const valid = new FormData(); valid.set("file", new File([new Uint8Array(png)], "image.png", { type: "image/png" }));
    expect((await POST(new Request("https://test.invalid/api/blob/upload", { method: "POST", body: valid }))).status).toBe(200);
  });
  it("continues storing generated PDF attachments", async () => {
    await expect(uploadAttachment({ fileName: "PO-test.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n") })).resolves.toMatchObject({ target: "local" });
  });
  it.each([
    ["payload.jpg", "image/jpeg"],
    ["payload.pdf", "application/pdf"],
  ])("rejects executable bytes spoofed as %s", async (fileName, mimeType) => {
    const executable = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(126), Buffer.from("PE\0\0")]);
    await expect(uploadAttachment({ fileName, mimeType, buffer: executable })).rejects.toThrow(/file content/i);
    expect(await readdir(directory)).toEqual([]);
  });
});
