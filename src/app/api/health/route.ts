import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Reports which build is actually live, and whether the deployment is configured.
 *
 * With auto-deploy on push there is otherwise no way to tell from outside whether the
 * running site includes a given commit, which is exactly the question worth answering
 * when a change "doesn't seem to have gone out". Uptime checks can poll this too.
 *
 * Deliberately reports only whether each secret is *present*, never its value, so the
 * endpoint stays safe to leave public.
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? "local",
    environment: process.env.VERCEL_ENV ?? "development",
    time: new Date().toISOString(),
    configured: {
      serviceAccount: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
      privateKey: Boolean(process.env.GOOGLE_PRIVATE_KEY),
      platformSheet: Boolean(process.env.PLATFORM_SHEET_ID),
      jwtSecret: Boolean(process.env.JWT_SECRET),
      cronSecret: Boolean(process.env.CRON_SECRET),
      blobStorage: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    },
  });
}
