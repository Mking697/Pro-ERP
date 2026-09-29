import { z } from "zod";

/**
 * Every "attachment URL" field across this app (invoice/PO/quotation documents, task
 * completion proofs, gate passes, PODs, ...) is a plain string the browser hands back after
 * its own direct-to-Blob upload (see file-upload-field.tsx) — nothing on the server ever
 * validated it was actually an http(s) link. A tampered request could submit
 * `javascript:...` instead, which every one of these fields' own detail dialogs later
 * renders as a plain `<a href={url}>` — a real stored-XSS vector against whichever colleague
 * (often an Admin, since these show up on Invoices/POs/Bills) later clicks the "attachment"
 * link inside their own authenticated session. Restricting to http/https closes it without
 * pinning a specific host, since a legitimate value is always a Blob URL but nothing here
 * depends on that beyond "it's a real link, not a script".
 */
function isHttpUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const INVALID_MESSAGE = "Attachment URL invalid hai.";

/** For fields that were plain `.trim().optional()` — stays `string | undefined`. */
export const attachmentUrlSchema = z
  .string()
  .trim()
  .optional()
  .refine((value) => !value || isHttpUrl(value), { message: INVALID_MESSAGE });

/** For fields that were `.trim().optional().default("")` — stays a plain `string`. */
export const attachmentUrlWithDefaultSchema = z
  .string()
  .trim()
  .optional()
  .default("")
  .refine((value) => !value || isHttpUrl(value), { message: INVALID_MESSAGE });
