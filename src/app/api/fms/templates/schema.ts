import { z } from "zod";

/** Shared by the create (POST /api/fms/templates) and edit (PUT
 * /api/fms/templates/[templateId]) routes, so the two can never drift apart. */
export const stepSchema = z
  .object({
    stepNo: z.coerce.number().int().positive(),
    stepName: z.string().trim().min(1, "Har step ka naam zaroori hai."),
    assignedTo: z.string().trim().min(1, "Har step kisi user ko assign hona chahiye."),
    tatValue: z.coerce.number().positive("TAT 0 se zyada hona chahiye."),
    tatUnit: z.enum(["Hours", "Days"]),
    outcomeOptions: z.array(z.string().trim().min(1)).min(1, "Kam se kam ek outcome chahiye."),
    nextStepMap: z.record(z.string(), z.union([z.literal("END"), z.coerce.number().int().positive()])),
    dataSourceConfig: z.string().trim().default(""),
    actionType: z.enum(["", "LEDGER_MOVEMENT"]).default(""),
    actionConfig: z.string().trim().default(""),
  })
  .refine((step) => step.outcomeOptions.every((o) => o in step.nextStepMap), {
    message: "Har outcome ke liye agla step (ya END) chunein.",
  });

export const templateBodySchema = z.object({
  templateName: z.string().trim().min(1, "Template ka naam zaroori hai."),
  triggerEvent: z.string().trim().min(1).default("MANUAL"),
  steps: z.array(stepSchema).min(1, "Kam se kam ek step chahiye."),
});
