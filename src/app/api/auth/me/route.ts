import { NextResponse } from "next/server";
import { getLiveSession } from "@/lib/auth/live-session";

export async function GET() {
  const session = await getLiveSession();
  return NextResponse.json({ user: session });
}
