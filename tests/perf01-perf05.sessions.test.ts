import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { chatMessages } from "@/db/schema";
const h = vi.hoisted(() => ({ order: vi.fn(), limit: vi.fn(), where: vi.fn(), find: vi.fn(), rows: [] as Record<string, unknown>[] }));
vi.mock("@/db/client", () => ({ db: { select: () => ({ from: () => ({ where: (predicate: unknown) => {
  h.where(predicate);
  return { orderBy: (...order: unknown[]) => {
    h.order(...order);
    const result = Promise.resolve(h.rows);
    return Object.assign(result, { limit: (count: number) => { h.limit(count); return Promise.resolve(h.rows.slice(0, count)); } });
  } };
} }) }) } }));
vi.mock("@/db/repo", () => ({ findById: h.find, insertRecord: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => "ORG-A" }));
import { recentSessionMessages, listSessionMessages, getMySession } from "@/lib/chatbot/sessions";
beforeEach(() => { vi.clearAllMocks(); h.rows = Array.from({ length: 30 }, (_, i) => ({ id: `M-${30-i}`, sessionId: "CHAT-A", role: "user", content: `${30-i}`, toolsUsed: [], createdAt: new Date(2026, 0, 1, 0, 30-i) })); });
it("bounds the SQL transcript read to 20 descending rows and returns them oldest-first", async () => {
  const result = await recentSessionMessages("CHAT-A");
  expect(h.limit).toHaveBeenCalledWith(20);
  const dialect = new PgDialect();
  expect(dialect.sqlToQuery(h.order.mock.calls[0][0]).sql).toContain('"chat_messages"."created_at" desc');
  const predicate = dialect.sqlToQuery(h.where.mock.calls[0][0]);
  expect(predicate.params).toEqual(["ORG-A", "CHAT-A"]);
  expect(result.map(row => row.id)).toEqual(h.rows.slice(0, 20).map(row => row.id).reverse());
  expect(h.rows[0].id).toBe("M-30");
  expect(result[0].createdAt).toBe((h.rows[19].createdAt as Date).toISOString());
  expect(chatMessages.orgId.name).toBe("org_id");
});
it("uses a deterministic descending ID tie-breaker at the cutoff", async () => {
  h.rows = h.rows.map(row => ({ ...row, createdAt: new Date("2026-01-01T00:00:00Z") }));
  await recentSessionMessages("CHAT-A", 3);
  const orders = h.order.mock.calls[0].map(expression => new PgDialect().sqlToQuery(expression).sql);
  expect(orders).toEqual(['"chat_messages"."created_at" desc', '"chat_messages"."id" desc']);
});
it.each([0, -1, 1.5, NaN, Infinity, 101])("rejects unsafe transcript limit %s before issuing SQL", async (limit) => {
  await expect(recentSessionMessages("CHAT-A", limit)).rejects.toThrow(RangeError);
  expect(h.where).not.toHaveBeenCalled();
});
it("uses the same deterministic ascending tie order for the full transcript", async () => {
  await listSessionMessages("CHAT-A");
  const orders = h.order.mock.calls[0].map(expression => new PgDialect().sqlToQuery(expression).sql);
  expect(orders).toEqual(['"chat_messages"."created_at" asc', '"chat_messages"."id" asc']);
});
it.each([20, 200, 20000])("keeps returned transcript rows and query count bounded for %s historical messages", async (size) => {
  h.rows = Array.from({ length: size }, (_, index) => ({ id: `M-${size - index}`, sessionId: "CHAT-A", role: "user", content: "message", toolsUsed: [], createdAt: new Date(size - index) }));
  const result = await recentSessionMessages("CHAT-A");
  expect(result).toHaveLength(20);
  expect(h.where).toHaveBeenCalledTimes(1);
  expect(h.limit).toHaveBeenCalledExactlyOnceWith(20);
  expect(result[0].id).toBe(h.rows[19].id);
  expect(result[19].id).toBe(h.rows[0].id);
});
it("still denies a same-tenant transcript session owned by another user", async () => {
  h.find.mockResolvedValue({ id: "CHAT-A", userId: "OTHER" });
  expect(await getMySession("USER-A", "CHAT-A")).toBeNull();
  expect(h.find).toHaveBeenCalledWith(expect.anything(), "ORG-A", "CHAT-A");
  expect(h.where).not.toHaveBeenCalled();
});
it("honors a smaller caller limit", async () => {
  expect((await recentSessionMessages("CHAT-A", 3)).map(row => row.id)).toEqual(["M-28", "M-29", "M-30"]);
  expect(h.limit).toHaveBeenCalledWith(3);
});
