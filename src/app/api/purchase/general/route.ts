import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import {
  createGeneralPurchaseOrder,
  GeneralPurchaseOrderError,
  listGeneralPurchaseOrders,
  type GeneralPoStage,
} from "@/lib/purchase/generalOrders";
import { getMutationKey, MutationConflictError } from "@/lib/mutations";

const STAGES: GeneralPoStage[] = ["follow_up", "receiving", "all"];

export async function GET(request: Request) {
  const guard = await requireModule("PURCHASE_FMS");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const stageParam = url.searchParams.get("stage");
  const stage = STAGES.includes(stageParam as GeneralPoStage) ? (stageParam as GeneralPoStage) : "all";

  const orders = await listGeneralPurchaseOrders(stage);
  return NextResponse.json({ orders });
}

const lineSchema = z.object({
  particular: z.string().trim().min(1, "Particular zaroori hai."),
  description: z.string().trim().optional().default(""),
  uom: z.string().trim().optional().default(""),
  qty: z.coerce.number().positive("Quantity 0 se zyada honi chahiye."),
  rate: z.coerce.number().min(0, "Rate 0 se kam nahi ho sakta."),
});

const createSchema = z.object({
  vendorId: z.string().trim().min(1, "Vendor chunein."),
  planId: z.string().trim().optional().default(""),
  lines: z.array(lineSchema).min(1, "Kam se kam ek item chunein."),
  attachmentUrl: z.string().trim().min(1, "PO attachment zaroori hai."),
  expectedDeliveryDays: z.coerce.number().min(0).default(0),
  gstPercent: z.coerce.number().min(0).max(100).optional(),
  termsAndConditions: z.string().trim().optional(),
  note: z.string().trim().optional(),
});

export async function POST(request: Request) {
  const guard = await requireModule("PURCHASE_FMS");
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const order = await createGeneralPurchaseOrder(
      { ...parsed.data, issuedBy: guard.session.email },
      getMutationKey(request)
    );
    return NextResponse.json({ order });
  } catch (err) {
    if (err instanceof MutationConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const message =
      err instanceof GeneralPurchaseOrderError || err instanceof Error
        ? err.message
        : "PO save nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
