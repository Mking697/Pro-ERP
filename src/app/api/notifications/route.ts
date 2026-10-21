import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { countUnreadNotifications, listMyNotifications } from "@/lib/notifications/notifications";

/** Every signed-in user has their own notifications — session-gated only, no module/role
 * check, mirroring the "everyone has their own X" reasoning src/lib/savedViews.ts's own
 * routes already use. */
export async function GET(request: Request) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const unreadOnly = new URL(request.url).searchParams.get("unreadOnly") === "true";

  const [notifications, unreadCount] = await Promise.all([
    listMyNotifications(guard.session.userId, { unreadOnly }),
    countUnreadNotifications(guard.session.userId),
  ]);

  return NextResponse.json({ notifications, unreadCount });
}
