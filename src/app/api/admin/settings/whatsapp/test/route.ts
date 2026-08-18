import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { getSetting } from "@/lib/settings";
import { sendWhatsAppMessage } from "@/lib/chatxflow";

export async function POST() {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const phone = await getSetting("CHATXFLOW_PHONE_NUMBER");
  if (!phone) {
    return NextResponse.json(
      { error: "Pehle WhatsApp Mobile Number save karein." },
      { status: 400 }
    );
  }

  const result = await sendWhatsAppMessage(
    phone,
    "Pro ERP se test message — WhatsApp integration sahi se kaam kar raha hai."
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Message bhej nahi paye." }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
