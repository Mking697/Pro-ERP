import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import {
  createPurchaseOrder,
  listPurchaseOrders,
  PurchaseOrderError,
  type PurchaseOrderStage,
} from "@/lib/purchase/orders";

const STAGES: PurchaseOrderStage[] = ["follow_up", "receiving", "all"];

export async function GET(request: Request) {
  const guard = await requireModule("PURCHASE_FMS");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const stageParam = url.searchParams.get("stage");
  const stage: PurchaseOrderStage = STAGES.includes(stageParam as PurchaseOrderStage)
    ? (stageParam as PurchaseOrderStage)
    : "all";

  const orders = await listPurchaseOrders(stage);
  return NextResponse.json({ orders });
}

const lineSchema = z.object({
  indentId: z.string().trim().min(1),
  newPrice: z.coerce.number().nonnegative().optional(),
});

const bodySchema = z.object({
  vendorId: z.string().trim().min(1, "Vendor chunein."),
  lines: z.array(lineSchema).min(1, "Kam se kam ek item chunein."),
  // Either a manually uploaded file's URL, or generateAttachment: true to have
  // createPurchaseOrder() auto-generate one right after the PO row is created — see its own
  // doc comment. Not requiring one or the other here lets createPurchaseOrder() itself stay
  // the single place that enforces "a PO needs an attachment."
  attachmentUrl: z.string().trim().optional(),
  generateAttachment: z.boolean().optional(),
  gstPercent: z.coerce.number().min(0).max(100).optional(),
  termsAndConditions: z.string().optional(),
  note: z.string().optional(),
});

export async function POST(request: Request) {
  const guard = await requireModule("PURCHASE_FMS");
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const order = await createPurchaseOrder({
      vendorId: parsed.data.vendorId,
      lines: parsed.data.lines,
      attachmentUrl: parsed.data.attachmentUrl ?? "",
      generateAttachment: parsed.data.generateAttachment,
      issuedBy: guard.session.userId,
      gstPercent: parsed.data.gstPercent,
      termsAndConditions: parsed.data.termsAndConditions,
      note: parsed.data.note,
    });
    return NextResponse.json({ order });
  } catch (err) {
    const message =
      err instanceof PurchaseOrderError || err instanceof Error
        ? err.message
        : "PO issue nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
