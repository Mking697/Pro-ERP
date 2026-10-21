import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns, getTableName, SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";

/**
 * DB-free unit tests for Phase B item #2 (in-app notification center) — same
 * "evaluate the real drizzle SQL against an in-memory row store" technique
 * tests/api-access.unit.test.ts already uses, so no live Postgres is required.
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
  for (const match of sql.matchAll(/"[^"]+"\."([^"]+)" in \(([^)]*)\)/g)) {
    const indexes = match[2].split(",").map((p) => Number(p.trim().replace("$", "")) - 1);
    const allowed = indexes.map((i) => params[i]);
    if (!allowed.includes(row[columns[match[1]]])) return false;
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
      const created = values.map((v) => ({ isRead: false, link: "", sourceEventId: "", createdAt: new Date(), ...v }));
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
    orderBy() {
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
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => "ORG-1" }));

beforeEach(() => {
  store = {};
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// eventToNotificationInputs — the event -> notification mapping logic
// ---------------------------------------------------------------------------

describe("eventToNotificationInputs", () => {
  it("maps task.assigned to one notification for the assignee", async () => {
    const { eventToNotificationInputs } = await import("@/lib/notifications/dispatch");
    const result = await eventToNotificationInputs("ORG-1", {
      type: "task.assigned",
      payload: { taskId: "TSK-1", assignedTo: "USR-2", title: "Clean the warehouse" },
    });
    expect(result).toEqual([
      {
        userId: "USR-2",
        type: "task.assigned",
        title: "Naya Task Assign Hua",
        body: "Clean the warehouse",
        link: "/tasks",
      },
    ]);
  });

  it("maps approval.pending to one notification for the approver", async () => {
    const { eventToNotificationInputs } = await import("@/lib/notifications/dispatch");
    const result = await eventToNotificationInputs("ORG-1", {
      type: "approval.pending",
      payload: { leaveId: "LV-1", approverId: "USR-3", stepNo: 1, requesterName: "Asha" },
    });
    expect(result).toEqual([
      {
        userId: "USR-3",
        type: "approval.pending",
        title: "Leave Approval Pending",
        body: "Asha ka leave request approval ke liye pending hai",
        link: "/leave",
      },
    ]);
  });

  it("maps order.status_changed by looking up the order's createdBy", async () => {
    store.orders = [{ id: "ORD-1", orgId: "ORG-1", createdBy: "USR-9" }];
    const { eventToNotificationInputs } = await import("@/lib/notifications/dispatch");
    const result = await eventToNotificationInputs("ORG-1", {
      type: "order.status_changed",
      payload: { orderId: "ORD-1", fromStatus: "Items_Pending", toStatus: "Payment_Review" },
    });
    expect(result).toEqual([
      {
        userId: "USR-9",
        type: "order.status_changed",
        title: "Order Status Update",
        body: 'Order ORD-1 ka status "Items_Pending" se "Payment_Review" ho gaya',
        link: "/orders",
      },
    ]);
  });

  it("skips gracefully (no crash) when the order has a blank createdBy (legacy row)", async () => {
    store.orders = [{ id: "ORD-2", orgId: "ORG-1", createdBy: "" }];
    const { eventToNotificationInputs } = await import("@/lib/notifications/dispatch");
    const result = await eventToNotificationInputs("ORG-1", {
      type: "order.status_changed",
      payload: { orderId: "ORD-2", fromStatus: "A", toStatus: "B" },
    });
    expect(result).toEqual([]);
  });

  it("an unrecognized event type maps to nothing", async () => {
    const { eventToNotificationInputs } = await import("@/lib/notifications/dispatch");
    const result = await eventToNotificationInputs("ORG-1", {
      type: "stock.movement_recorded",
      payload: {},
    });
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// markNotificationsRead / markAllNotificationsRead — scoping
// ---------------------------------------------------------------------------

describe("markNotificationsRead / markAllNotificationsRead", () => {
  function seed() {
    store.notifications = [
      { id: "NTF-1", orgId: "ORG-1", userId: "USR-A", isRead: false, type: "task.assigned", title: "T1", body: "", link: "", sourceEventId: "", createdAt: new Date() },
      { id: "NTF-2", orgId: "ORG-1", userId: "USR-A", isRead: false, type: "task.assigned", title: "T2", body: "", link: "", sourceEventId: "", createdAt: new Date() },
      { id: "NTF-3", orgId: "ORG-1", userId: "USR-B", isRead: false, type: "task.assigned", title: "T3", body: "", link: "", sourceEventId: "", createdAt: new Date() },
    ];
  }

  it("marks only the given ids read, for the calling user", async () => {
    seed();
    const { markNotificationsRead } = await import("@/lib/notifications/notifications");
    await markNotificationsRead("USR-A", ["NTF-1"]);
    const rowsNow = store.notifications;
    expect(rowsNow.find((r) => r.id === "NTF-1")!.isRead).toBe(true);
    expect(rowsNow.find((r) => r.id === "NTF-2")!.isRead).toBe(false);
  });

  it("never lets a user mark-read another user's notification by guessing its id", async () => {
    seed();
    const { markNotificationsRead } = await import("@/lib/notifications/notifications");
    // USR-A tries to mark USR-B's own notification read.
    await markNotificationsRead("USR-A", ["NTF-3"]);
    expect(store.notifications.find((r) => r.id === "NTF-3")!.isRead).toBe(false);
  });

  it("markAllNotificationsRead only ever touches the calling user's own rows", async () => {
    seed();
    const { markAllNotificationsRead } = await import("@/lib/notifications/notifications");
    await markAllNotificationsRead("USR-A");
    const rowsNow = store.notifications;
    expect(rowsNow.find((r) => r.id === "NTF-1")!.isRead).toBe(true);
    expect(rowsNow.find((r) => r.id === "NTF-2")!.isRead).toBe(true);
    // USR-B's unread row is untouched.
    expect(rowsNow.find((r) => r.id === "NTF-3")!.isRead).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// API route auth — 401 with no session, basic shape with one
// ---------------------------------------------------------------------------

describe("GET /api/notifications", () => {
  it("401s with no session", async () => {
    vi.doMock("@/lib/auth/guard", () => ({
      requireSession: vi.fn(async () => ({
        ok: false,
        response: new Response(JSON.stringify({ error: "Unauthorized." }), { status: 401 }),
      })),
    }));
    const { GET } = await import("@/app/api/notifications/route");
    const res = await GET(new Request("http://x/api/notifications"));
    expect(res.status).toBe(401);
    vi.doUnmock("@/lib/auth/guard");
  });

  it("returns { notifications, unreadCount } for a real session", async () => {
    vi.doMock("@/lib/auth/guard", () => ({
      requireSession: vi.fn(async () => ({ ok: true, session: { userId: "USR-A" } })),
    }));
    vi.doMock("@/lib/notifications/notifications", () => ({
      listMyNotifications: vi.fn(async () => [{ id: "NTF-1" }]),
      countUnreadNotifications: vi.fn(async () => 1),
    }));
    const { GET } = await import("@/app/api/notifications/route");
    const res = await GET(new Request("http://x/api/notifications"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ notifications: [{ id: "NTF-1" }], unreadCount: 1 });
    vi.doUnmock("@/lib/auth/guard");
    vi.doUnmock("@/lib/notifications/notifications");
  });
});

describe("POST /api/notifications/mark-read", () => {
  it("401s with no session", async () => {
    vi.doMock("@/lib/auth/guard", () => ({
      requireSession: vi.fn(async () => ({
        ok: false,
        response: new Response(JSON.stringify({ error: "Unauthorized." }), { status: 401 }),
      })),
    }));
    const { POST } = await import("@/app/api/notifications/mark-read/route");
    const res = await POST(new Request("http://x", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
    vi.doUnmock("@/lib/auth/guard");
  });

  it("400s on an invalid body", async () => {
    vi.doMock("@/lib/auth/guard", () => ({
      requireSession: vi.fn(async () => ({ ok: true, session: { userId: "USR-A" } })),
    }));
    const { POST } = await import("@/app/api/notifications/mark-read/route");
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
    vi.doUnmock("@/lib/auth/guard");
  });
});
