import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns, getTableName, SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";

/**
 * DB-free unit tests for Phase B item #1 (API keys + webhooks) — no live Postgres
 * required. `@/db/client`'s `db` is replaced with a tiny in-memory fake supporting the
 * exact `select/insert/update/delete` chains these two lib files issue, mirroring the
 * same "evaluate the real drizzle SQL against an in-memory row store" technique
 * tests/dispatch-unit.test.ts already uses for this codebase's own domain-mutation tests.
 */

type Row = Record<string, unknown>;
let store: Record<string, Row[]>;
const dialect = new PgDialect();
const rows = (name: string) => store[name] ?? (store[name] = []);

function columnNameMap(): Record<string, string> {
  const columns: Record<string, string> = {};
  for (const table of Object.values(schema)) {
    try {
      for (const [key, col] of Object.entries(getTableColumns(table as never))) {
        columns[(col as { name: string }).name] = key;
      }
    } catch {
      /* enums etc. — not a table */
    }
  }
  return columns;
}

function matches(condition: SQL | undefined, row: Row): boolean {
  if (!condition) return true;
  const { sql, params } = dialect.sqlToQuery(condition);
  const columns = columnNameMap();
  for (const match of sql.matchAll(/"[^"]+"\."([^"]+)" = \$(\d+)/g)) {
    if (row[columns[match[1]]] !== params[Number(match[2]) - 1]) return false;
  }
  for (const match of sql.matchAll(/"[^"]+"\."([^"]+)" is null/g)) {
    if (row[columns[match[1]]] !== null && row[columns[match[1]]] !== undefined) return false;
  }
  for (const match of sql.matchAll(/"[^"]+"\."([^"]+)" <= \$(\d+)/g)) {
    const rowValue = row[columns[match[1]]];
    const rowTime = rowValue instanceof Date ? rowValue.getTime() : null;
    const paramTime = new Date(params[Number(match[2]) - 1] as string).getTime();
    if (rowTime === null || rowTime > paramTime) return false;
  }
  return true;
}

function builder(table: unknown, kind: string, selection?: Row) {
  const name = getTableName(table as never);
  let condition: SQL | undefined;
  let values: Row[] = [];
  let changes: Row = {};
  let limit = Infinity;
  const execute = async () => {
    if (kind === "insert") {
      const created = values.map((v) => ({ createdAt: new Date(), revokedAt: null, lastUsedAt: null, isActive: true, cursorEventId: null, attemptCount: 0, status: "Pending", lastAttemptAt: null, nextRetryAt: null, responseStatus: null, responseSnippet: "", ...v }));
      rows(name).push(...created);
      return created;
    }
    let selected = rows(name).filter((r) => matches(condition, r));
    if (kind === "update") {
      for (const row of selected) Object.assign(row, changes);
    }
    if (kind === "delete") {
      store[name] = rows(name).filter((r) => !selected.includes(r));
    }
    selected = selected.slice(0, limit);
    if (selection) {
      const projection = selection;
      return selected.map((r) =>
        Object.fromEntries(
          Object.entries(projection).map(([key, col]) => [
            key,
            r[(col as { name: string }).name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())],
          ])
        )
      );
    }
    return selected;
  };
  const b = {
    where(c: SQL) {
      condition = c;
      return b;
    },
    limit(n: number) {
      limit = n;
      return b;
    },
    values(v: Row | Row[]) {
      values = Array.isArray(v) ? v : [v];
      return b;
    },
    set(v: Row) {
      changes = v;
      return b;
    },
    returning(s?: Row) {
      selection = s;
      return b;
    },
    execute,
    then(resolve: (r: Row[]) => unknown, reject: (e: unknown) => unknown) {
      return execute().then(resolve, reject);
    },
    catch(reject: (e: unknown) => unknown) {
      return execute().catch(reject);
    },
  };
  return b;
}

const fakeDb = {
  select: (selection?: Row) => ({ from: (table: unknown) => builder(table, "select", selection) }),
  insert: (table: unknown) => builder(table, "insert"),
  update: (table: unknown) => builder(table, "update"),
  delete: (table: unknown) => builder(table, "delete"),
};

vi.mock("@/db/client", () => ({ db: fakeDb }));

beforeEach(() => {
  store = {};
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

describe("apiKeys", () => {
  it("generate/verify/revoke roundtrip — plaintext never retrievable after creation, revoked key rejected", async () => {
    const { generateApiKey, verifyApiKey, listApiKeys, revokeApiKey } = await import("@/lib/apiAccess/apiKeys");

    const created = await generateApiKey("ORG-1", "Tally Sync", "USR-1");
    expect(created.plaintextKey).toMatch(/^pk_live_/);

    // Verifies against the real org.
    expect(await verifyApiKey(created.plaintextKey)).toBe("ORG-1");

    // Listing never surfaces the hash or the plaintext.
    const listed = await listApiKeys("ORG-1");
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty("keyHash");
    expect(JSON.stringify(listed[0])).not.toContain(created.plaintextKey);

    // Revoke, scoped to the real org — then the same key stops verifying.
    expect(await revokeApiKey("ORG-1", created.id)).toBe(true);
    expect(await verifyApiKey(created.plaintextKey)).toBeNull();

    // A revoked key can't be revoked again.
    expect(await revokeApiKey("ORG-1", created.id)).toBe(false);
  });

  it("never lets one org revoke another org's key", async () => {
    const { generateApiKey, revokeApiKey } = await import("@/lib/apiAccess/apiKeys");
    const created = await generateApiKey("ORG-1", "Key", "USR-1");
    expect(await revokeApiKey("ORG-2", created.id)).toBe(false);
  });

  it("an unknown key verifies to null", async () => {
    const { verifyApiKey } = await import("@/lib/apiAccess/apiKeys");
    expect(await verifyApiKey("pk_live_not-a-real-key")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Webhooks — SSRF validation
// ---------------------------------------------------------------------------

describe("isPrivateOrLocalHost (SSRF guard)", () => {
  it.each([
    "http://localhost/hook",
    "http://127.0.0.1/hook",
    "http://10.1.2.3/hook",
    "http://172.16.0.1/hook",
    "http://172.31.255.255/hook",
    "http://192.168.1.1/hook",
    "http://169.254.169.254/hook",
    "not a url",
    "http://[::1]/hook",
  ])("rejects %s", async (url) => {
    const { isPrivateOrLocalHost } = await import("@/lib/apiAccess/webhooks");
    expect(isPrivateOrLocalHost(url)).toBe(true);
  });

  it.each(["https://example.com/webhooks", "http://api.my-saas.io/hook", "http://172.32.0.1/hook"])(
    "allows %s",
    async (url) => {
      const { isPrivateOrLocalHost } = await import("@/lib/apiAccess/webhooks");
      expect(isPrivateOrLocalHost(url)).toBe(false);
    }
  );
});

describe("createWebhookSubscription", () => {
  it("rejects a private/localhost URL", async () => {
    const { createWebhookSubscription, WebhookError } = await import("@/lib/apiAccess/webhooks");
    await expect(
      createWebhookSubscription("ORG-1", { url: "http://localhost:3000/hook", eventTypes: ["order.status_changed"] }, "USR-1")
    ).rejects.toThrow(WebhookError);
  });

  it("rejects an empty/invalid event type list", async () => {
    const { createWebhookSubscription, WebhookError } = await import("@/lib/apiAccess/webhooks");
    await expect(
      createWebhookSubscription("ORG-1", { url: "https://example.com/hook", eventTypes: ["not.a.real.type"] }, "USR-1")
    ).rejects.toThrow(WebhookError);
  });

  it("creates with a plaintext secret shown once, never returned by list", async () => {
    const { createWebhookSubscription, listWebhookSubscriptions } = await import("@/lib/apiAccess/webhooks");
    const created = await createWebhookSubscription(
      "ORG-1",
      { url: "https://example.com/hook", eventTypes: ["order.status_changed"] },
      "USR-1"
    );
    expect(created.plaintextSecret).toBeTruthy();

    const listed = await listWebhookSubscriptions("ORG-1");
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed[0])).not.toContain(created.plaintextSecret);
  });
});

// ---------------------------------------------------------------------------
// Webhooks — HMAC signature
// ---------------------------------------------------------------------------

describe("signPayload", () => {
  it("produces a stable sha256=<hex> HMAC over the exact raw body", async () => {
    const { signPayload } = await import("@/lib/apiAccess/webhooks");
    const { createHmac } = await import("node:crypto");
    const body = JSON.stringify({ id: "EVT-1", type: "order.status_changed", payload: {}, createdAt: "2026-01-01" });
    const expected = `sha256=${createHmac("sha256", "my-secret").update(body).digest("hex")}`;
    expect(signPayload("my-secret", body)).toBe(expected);
  });

  it("changes when the body changes (tamper-evident)", async () => {
    const { signPayload } = await import("@/lib/apiAccess/webhooks");
    const sigA = signPayload("secret", JSON.stringify({ a: 1 }));
    const sigB = signPayload("secret", JSON.stringify({ a: 2 }));
    expect(sigA).not.toBe(sigB);
  });
});

// ---------------------------------------------------------------------------
// Webhooks — cursor / retry / backoff / abandon
// ---------------------------------------------------------------------------

describe("dispatchPendingWebhooks", () => {
  it("delivers a page of events, advances the cursor, and signs each POST", async () => {
    vi.doMock("@/lib/events/emit", () => ({
      listDomainEventsSince: vi.fn(async (_orgId: string, sinceId: string | null) => {
        if (sinceId === null) {
          return {
            events: [
              { id: "EVT-1", orgId: "ORG-1", type: "order.status_changed", payload: { orderId: "ORD-1" }, createdAt: new Date() },
            ],
            nextSinceId: "EVT-1",
          };
        }
        return { events: [], nextSinceId: sinceId };
      }),
    }));

    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { createWebhookSubscription, dispatchPendingWebhooks } = await import("@/lib/apiAccess/webhooks");
    await createWebhookSubscription(
      "ORG-1",
      { url: "https://example.com/hook", eventTypes: ["order.status_changed"] },
      "USR-1"
    );

    const result = await dispatchPendingWebhooks();
    expect(result.processed).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ "Content-Type": "application/json" });
    expect((init as { headers: Record<string, string> }).headers["X-Pro-ERP-Signature"]).toMatch(/^sha256=/);

    const subs = store["webhook_subscriptions"];
    expect(subs[0].cursorEventId).toBe("EVT-1");

    const deliveries = store["webhook_deliveries"];
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe("Success");
    vi.doUnmock("@/lib/events/emit");
  });

  it("marks a failing delivery Failed with a backoff, then Abandoned after 3 attempts", async () => {
    vi.doMock("@/lib/events/emit", () => ({
      listDomainEventsSince: vi.fn(async (_orgId: string, sinceId: string | null) => {
        if (sinceId === null) {
          return {
            events: [{ id: "EVT-1", orgId: "ORG-1", type: "stock.movement_recorded", payload: {}, createdAt: new Date() }],
            nextSinceId: "EVT-1",
          };
        }
        return { events: [], nextSinceId: sinceId };
      }),
    }));
    vi.stubGlobal("fetch", vi.fn(async (_url: string, _init?: RequestInit) => new Response("boom", { status: 500 })));

    const { createWebhookSubscription, dispatchPendingWebhooks } = await import("@/lib/apiAccess/webhooks");
    await createWebhookSubscription(
      "ORG-1",
      { url: "https://example.com/hook", eventTypes: ["stock.movement_recorded"] },
      "USR-1"
    );

    // Attempt 1 — delivered (fails), becomes Failed with a nextRetryAt in the future.
    await dispatchPendingWebhooks();
    let delivery = store["webhook_deliveries"][0];
    expect(delivery.status).toBe("Failed");
    expect(delivery.attemptCount).toBe(1);
    // Cursor still advances past this event even though its delivery is still retrying.
    expect(store["webhook_subscriptions"][0].cursorEventId).toBe("EVT-1");

    // Force the retry to be due immediately for attempts 2 and 3.
    delivery.nextRetryAt = new Date(Date.now() - 1000);
    await dispatchPendingWebhooks();
    delivery = store["webhook_deliveries"][0];
    expect(delivery.status).toBe("Failed");
    expect(delivery.attemptCount).toBe(2);

    delivery.nextRetryAt = new Date(Date.now() - 1000);
    await dispatchPendingWebhooks();
    delivery = store["webhook_deliveries"][0];
    expect(delivery.status).toBe("Abandoned");
    expect(delivery.attemptCount).toBe(3);
    expect(delivery.nextRetryAt).toBeNull();

    // A 4th poll must never retry an Abandoned delivery again.
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchSpy.mockClear();
    await dispatchPendingWebhooks();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/events/emit");
  });
});
