import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";

// Reachable without a session.
//
// /share/<token> is deliberately here: the token is the credential, and the page resolves
// its tenant from that token alone rather than from any session cookie.
const PUBLIC_PATHS = ["/login", "/signup", "/share"];

/**
 * Public pages that a signed-in person has no business seeing — they get sent home.
 *
 * Only the sign-in flow belongs here. A share link must open for everybody: it is passed
 * around in messages, and half the people who receive it work at the company and are
 * already signed in. Bouncing them to their own dashboard makes the link look broken to
 * exactly the people most likely to click it.
 */
const AUTH_PATHS = ["/login", "/signup"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Routes that authenticate themselves and must not be bounced to /login.
  //
  // Signup has no session by definition. Cron routes are called by Vercel Cron with only
  // an Authorization header and no cookie — redirecting those to /login means the daily
  // jobs silently never run. Both cron handlers check CRON_SECRET (all organizations) or
  // an Admin session (their own organization) before doing any work.
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/signup") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/api/cron") ||
    pathname.startsWith("/api/whatsapp/send-reminders")
  ) {
    return NextResponse.next();
  }

  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session && !isPublicPath) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (session && AUTH_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
