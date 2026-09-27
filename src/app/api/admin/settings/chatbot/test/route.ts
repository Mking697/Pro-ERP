import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { getGeminiApiKey, testGeminiKey } from "@/lib/chatbot/gemini";

/** A minimal, real Gemini call to confirm the saved key actually works — mirrors the
 * WhatsApp settings form's own "Send Test Message" button. */
export async function POST() {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const apiKey = await getGeminiApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: "Pehle apna Gemini API key save karein." }, { status: 400 });
  }

  const result = await testGeminiKey(apiKey);
  if (!result.ok) {
    return NextResponse.json({ error: result.error || "Gemini key test fail ho gaya." }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
