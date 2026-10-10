import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, isInTenantTransaction, runInTenantTransaction } from "@/db/client";
import { mutationReceipts } from "@/db/schema";

/** JSON DTOs only: convert domain Date fields explicitly to ISO strings. */
export type MutationJsonValue = null | boolean | number | string | MutationJsonValue[] | { [key: string]: MutationJsonValue };
export interface TenantMutationOptions {
  /** Version when the parsed payload or returned DTO contract changes. */
  operation: string;
  /** Trusted authenticated actor, not an unverified body field. */
  actorId: string;
  key?: string;
  /** Parsed and validated domain input; never raw request text. */
  payload: MutationJsonValue;
}

export class MutationConflictError extends Error {
  readonly status = 409;
  readonly code = "MUTATION_CONFLICT";
  constructor() {
    super("Idempotency key is already bound to a different actor, operation or payload");
    this.name = "MutationConflictError";
  }
}

export class MutationInputError extends Error {
  readonly status = 400;
  readonly code = "MUTATION_INPUT_INVALID";
  constructor(message: string) { super(message); this.name = "MutationInputError"; }
}

function validateKey(key: unknown): asserts key is string | undefined {
  // Opaque, case-sensitive, 1–200 printable ASCII characters, without whitespace.
  if (key !== undefined && (typeof key !== "string" || !/^[\x21-\x7e]{1,200}$/.test(key))) {
    throw new MutationInputError("Idempotency key must be 1–200 printable ASCII characters without whitespace");
  }
}

/** Header only. Fetch Headers may already trim HTTP boundary whitespace; we never trim. */
export function getMutationKey(request: Request): string | undefined {
  const key = request.headers.get("Idempotency-Key") ?? undefined;
  validateKey(key);
  return key;
}

/** Sort object keys only; preserve array order. Reject lossy JS values, never call toJSON. */
function canonicalJson(value: unknown, label: "payload" | "result"): string {
  const ancestors = new Set<object>();
  const fail = (reason: string): never => {
    const message = `${label} must be JSON-safe: ${reason}`;
    if (label === "payload") throw new MutationInputError(message);
    throw new TypeError(message);
  };
  function quote(text: string): string {
    // PostgreSQL JSONB cannot represent NUL or unpaired UTF-16 surrogate escapes.
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code === 0) fail("NUL characters are unsupported by PostgreSQL JSONB");
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(++index);
        if (!(next >= 0xdc00 && next <= 0xdfff)) fail("unpaired Unicode surrogates are unsupported");
      } else if (code >= 0xdc00 && code <= 0xdfff) fail("unpaired Unicode surrogates are unsupported");
    }
    return JSON.stringify(text);
  }
  function visit(item: unknown, depth: number): string {
    if (depth > 100) fail("maximum nesting depth is 100");
    if (item === null) return "null";
    if (typeof item === "string") return quote(item);
    if (typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number") {
      if (!Number.isFinite(item)) fail("non-finite numbers are unsupported");
      return JSON.stringify(item);
    }
    if (typeof item !== "object") return fail(`${typeof item} is unsupported`);
    const object = item as object;
    if (ancestors.has(object)) fail("circular references are unsupported");
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
      fail("only plain objects and arrays are supported (Date must be an explicit ISO string)");
    }
    ancestors.add(object);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(item);
      const keys = Reflect.ownKeys(item);
      for (const key of keys) {
        if (Array.isArray(item) && key === "length") continue;
        if (typeof key !== "string") fail("symbol properties are unsupported");
        const descriptor = descriptors[key as string];
        if (!descriptor.enumerable || !("value" in descriptor)) fail("only enumerable data properties are supported");
      }
      if (Array.isArray(item)) {
        if (keys.length !== item.length + 1) fail("sparse arrays or extra array properties are unsupported");
        const parts: string[] = [];
        for (let index = 0; index < item.length; index++) {
          const descriptor = descriptors[String(index)];
          if (!descriptor) fail("sparse arrays are unsupported");
          parts.push(visit(descriptor.value, depth + 1));
        }
        return `[${parts.join(",")}]`;
      }
      return `{${Object.keys(descriptors).sort().map((key) => `${quote(key)}:${visit(descriptors[key].value, depth + 1)}`).join(",")}}`;
    } finally { ancestors.delete(object); }
  }
  return visit(value, 0);
}

/**
 * Durable replay keyed ONLY by (tenant, caller key), never by payment amount.
 * Tenant admission serializes concurrent transactions before reading receipts.
 * Receipt and domain writes commit/roll back together; create DB builders inside work.
 * Missing key runs transactionally but offers NO retry/replay guarantee.
 * Owns a top-level transaction: do not call inside runInTenantTransaction or another mutation.
 * Authenticated service entries resolve/authorize tenant and actor before entry, then
 * invoke internal domain functions inside work; do not compose idempotent wrappers.
 * Keep orgId aligned with the validated tenant context used by downstream reads.
 * T is a JSON DTO on first execution AND replay: convert Dates explicitly to ISO strings.
 * Work contains DB writes only; afterTenantCommit effects are NOT a durable outbox.
 * Do not blindly retry committed:true errors. Version operation when DTO contracts change.
 */
export async function runIdempotentTenantMutation<T extends MutationJsonValue>(
  orgId: string, options: TenantMutationOptions, work: () => Promise<T>,
): Promise<T> {
  // Joining an existing scope would allow parallel receipt checks and swallowed work
  // errors to commit incomplete mutations. Own the top-level rollback boundary instead.
  if (isInTenantTransaction()) throw new Error("Idempotent mutation must own a top-level tenant transaction");
  const { key, actorId, operation, payload } = options;
  validateKey(key);
  if (typeof actorId !== "string" || !actorId.trim() || typeof operation !== "string" || !operation.trim()) {
    throw new MutationInputError("actorId and operation must be non-blank strings");
  }
  const payloadHash = createHash("sha256").update(canonicalJson({ actorId, operation, payload }, "payload")).digest("hex");
  return runInTenantTransaction(orgId, async () => {
    if (key !== undefined) {
      const [receipt] = await db.select().from(mutationReceipts)
        .where(and(eq(mutationReceipts.orgId, orgId), eq(mutationReceipts.key, key))).limit(1);
      if (receipt) {
        if (receipt.actorId !== actorId || receipt.operation !== operation || receipt.payloadHash !== payloadHash) {
          throw new MutationConflictError();
        }
        return JSON.parse(canonicalJson(receipt.result, "result")) as T;
      }
    }
    // Return the JSON representation for identical first/replay semantics (-0, prototypes).
    const resultJson = canonicalJson(await work(), "result");
    const result = JSON.parse(resultJson) as T;
    if (key !== undefined) {
      // Explicit cast preserves JSON null (a JS null parameter otherwise becomes SQL NULL).
      await db.insert(mutationReceipts).values({ orgId, key, actorId, operation, payloadHash, result: sql`${resultJson}::jsonb` });
    }
    return result;
  });
}
