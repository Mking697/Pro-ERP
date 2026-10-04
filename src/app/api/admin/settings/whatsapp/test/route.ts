import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { getSetting } from "@/lib/settings";
import { sendWhatsAppMessage } from "@/lib/chatxflow";
import { checkRateLimit } from "@/lib/rateLimit";

const WHATSAPP_TEST_LIMIT = 5;
const WHATSAPP_TEST_WINDOW_SECONDS = 60 * 60;

export async function POST() {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  // Every other sensitive-action/outbound-egress route in this codebase is rate-limited
  // (login, signup, the WhatsApp settings save itself) — this one wasn't, even though it
  // triggers a real outbound HTTP call to the configured CHATXFLOW_BASE_URL on every POST.
  // Keyed per-org so one Admin's hammering can't exhaust another tenant's quota.
  const rate = await checkRateLimit(
    "whatsapp-test",
    guard.session.orgId,
    WHATSAPP_TEST_LIMIT,
    WHATSAPP_TEST_WINDOW_SECONDS
  );
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Bahut zyada koshishein ho gayi hain. Thodi der baad try karein." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
    );
  }

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
