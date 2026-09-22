import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import { errorLogs } from "@/db/schema";
import { generateId } from "@/lib/id";

export interface LogErrorInput {
  orgId?: string;
  routePath?: string;
  routeType?: string;
  message: string;
  digest?: string;
  stack?: string;
}

/**
 * Records a server error for the `/platform` diagnostics view — best-effort, always. A
 * failure here (a DB hiccup while trying to log a DB hiccup) must never throw back into
 * the caller, or logging a problem would itself become a second, worse problem.
 */
export async function logError(input: LogErrorInput): Promise<void> {
  try {
    await db.insert(errorLogs).values({
      id: generateId("ERR"),
      orgId: input.orgId ?? "",
      routePath: input.routePath ?? "",
      routeType: input.routeType ?? "",
      message: input.message.slice(0, 4000),
      digest: input.digest ?? "",
      stack: (input.stack ?? "").slice(0, 8000),
    });
  } catch (err) {
    console.error("[errorLog] failed to persist error log:", err);
  }
}

export async function listErrorLogs(limit = 200) {
  return db.select().from(errorLogs).orderBy(desc(errorLogs.createdAt)).limit(limit);
}
