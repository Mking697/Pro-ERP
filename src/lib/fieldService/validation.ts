import { z } from "zod";
import type { FieldTaskType } from "./core";
import type { CreateServiceJobInput } from "./serviceJobs";
import type { CreateComplaintInput } from "./complaints";
import type { CreateSiteVisitInput } from "./siteVisits";
import type { Step1Input, Step2Input, Step3Input } from "./steps";

export class FieldValidationError extends Error {}
const text = z.string().trim().max(10000);
const id = z.string().min(1).max(200).refine((s) => s === s.trim() && !/\s/.test(s));
const amount = z.number().finite().min(0).max(999999999);
export const cycleSchema = z.number().int().positive().max(2147483647);
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new FieldValidationError("Invalid field service input.");
  return result.data;
}

/** Exact local-storage key format; URL normalization must not hide traversal.
 * Absolute URLs are accepted only under the deployment's configured public base. */
export function validateUpload(value: unknown, orgId: string, optional = false, base = process.env.PUBLIC_UPLOADS_BASE_URL || "/uploads"): string {
  if (optional && (value === undefined || value === "")) return "";
  if (typeof value !== "string" || value.length > 2048 || /[%\\?#\s]/.test(value)) throw new FieldValidationError("Invalid attachment URL.");
  const prefix = `${base.replace(/\/$/, "")}/orgs/${orgId}/`;
  const key = value.startsWith(prefix) ? value.slice(prefix.length) : "";
  if (!/^ATT-[A-Za-z0-9_-]+-[A-Za-z0-9._-]+$/.test(key) || key.includes("..")) throw new FieldValidationError("Attachment must belong to this organization.");
  return value;
}
function uploadSchema(orgId: string, optional = true) {
  return z.unknown().optional().transform((v) => validateUpload(v, orgId, optional));
}
const common = { customerId: id, siteAddress: text.optional(), attendantName: text.optional(), attendantPhone: text.max(100).optional() };
export function validateCreate(type: "SERVICE", value: unknown, orgId: string): CreateServiceJobInput;
export function validateCreate(type: "COMPLAINT", value: unknown, orgId: string): CreateComplaintInput;
export function validateCreate(type: "SITE_VISIT", value: unknown, orgId: string): CreateSiteVisitInput;
export function validateCreate(type: FieldTaskType, value: unknown, orgId: string): CreateServiceJobInput | CreateComplaintInput | CreateSiteVisitInput {
  if (type === "SERVICE") return parse(z.object({ ...common, productDetails: text.optional(), brand: text.optional() }), value);
  if (type === "COMPLAINT") return parse(z.object({ ...common, jobReference: text.optional(), warrantyStatus: z.enum(["In_Warranty", "Out_Of_Warranty"]).default("Out_Of_Warranty"), issueDescription: text.min(1), attachmentUrl: uploadSchema(orgId), mediaUrls: z.array(uploadSchema(orgId, false)).max(20).optional() }), value);
  return parse(z.object({ ...common, raisedVia: text.optional(), raisedByName: text.optional(), siteLatitude: z.number().finite().min(-90).max(90).nullable().optional(), siteLongitude: z.number().finite().min(-180).max(180).nullable().optional(), visitFor: z.enum(["Installation_Check", "Quality_Complaint", "Sales_Demo", "Other"]).default("Other") }).refine((v) => (v.siteLatitude == null) === (v.siteLongitude == null)), value);
}
export function validateAssignment(value: unknown, orgId: string) {
  if (!orgId.trim()) throw new FieldValidationError("Organization required.");
  return parse(z.object({ doerIds: z.array(id).min(1).max(100).refine((v) => new Set(v).size === v.length), fundAmount: amount.nullable().optional(), fundNotes: text.optional(), cycle: cycleSchema.optional() }), value);
}
export function validateStep(type: FieldTaskType, step: 1, value: unknown, orgId: string): Step1Input;
export function validateStep(type: FieldTaskType, step: 2, value: unknown, orgId: string): Step2Input;
export function validateStep(type: FieldTaskType, step: 3, value: unknown, orgId: string): Step3Input;
export function validateStep(type: FieldTaskType, step: number, value: unknown, orgId: string): Step1Input | Step2Input | Step3Input {
  if (step === 1) return parse(z.object({ sitePhotoUrl: uploadSchema(orgId, false), siteVideoUrl: uploadSchema(orgId), latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) }), value);
  if (step === 2) return parse(z.object({ evidenceUrl: uploadSchema(orgId, type === "SITE_VISIT"), notes: type === "SITE_VISIT" ? text.min(1) : text.optional(), chartUrl: uploadSchema(orgId) }), value);
  if (step === 3) return parse(z.object({ expenseAmount: amount, expenseNotes: text.optional(), billUrls: z.array(uploadSchema(orgId, false)).max(20).optional() }), value);
  throw new FieldValidationError("Invalid step.");
}
export function parseCycle(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) throw new FieldValidationError("Invalid cycle.");
  return parse(cycleSchema, Number(value));
}
export function validateCycle(value: unknown): number { return parse(cycleSchema, value); }
export function assertStepTransition(task: {status: string; currentCycle: number}, row: {step1At?: unknown; step2At?: unknown; step3At?: unknown} | null, step: number, cycle: number): void {
  if (cycle !== task.currentCycle || task.status === "Completed" || !Number.isSafeInteger(cycle) || cycle < 1) throw new FieldValidationError("Task cycle is no longer active.");
  const valid = step === 1 ? task.status === "Assigned" && !row : task.status === "In_Progress" && !!row?.step1At && !row.step3At && (step === 2 ? !row.step2At : step === 3 && !!row.step2At);
  if (!valid) throw new FieldValidationError("Step already completed or submitted out of order.");
}
