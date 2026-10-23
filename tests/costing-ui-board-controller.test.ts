import { describe, expect, it, vi } from "vitest";
import { CostSheetController } from "@/lib/costing/client";
import type { CostSheet, CostSheetInput } from "@/lib/costing/types";

export const input: CostSheetInput = { productSku: "FG", batchQty: "2", asOfDate: "2026-10-23", charges: [] };
import { calculateCostSheet } from "@/lib/costing/engine";
import { facts } from "./costing-fixtures";
export const sheet: CostSheet = { id: "s1", productSku: "FG", productName: "Product", revision: 1, status: "Draft", version: 1, calculation: calculateCostSheet(input, facts), supersedesId: null, createdAt: "2026-10-23T00:00:00Z", createdBy: "U", updatedAt: "2026-10-23T00:00:00Z", finalizedAt: null, finalizedBy: null };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };

describe("cost sheet mutation controller", () => {
  it("accepts equivalent PostgreSQL JSONB key ordering on readback and subsequent finalization", async () => {
    const reordered = { ...sheet, calculation: { ...sheet.calculation, input: { charges: [], asOfDate: input.asOfDate, batchQty: input.batchQty, productSku: input.productSku } } };
    const c = new CostSheetController(input, vi.fn<typeof fetch>(async (_url, options) => json({ sheet: options?.method === "POST" ? sheet : reordered })));
    await c.save();
    expect(c.getSnapshot().error).toBeNull();
    expect(c.getSnapshot().notice).toBe("saved");
    expect(c.canFinalize()).toBe(true);
  });
  it("suppresses old preview JSON after product edits", async () => {
    const body = deferred<unknown>();
    const c = new CostSheetController(input, vi.fn<typeof fetch>(async () => ({ ok: true, json: () => body.promise }) as Response));
    const request = c.preview();
    await Promise.resolve();
    c.edit({ ...input, productSku: "OTHER" });
    body.resolve({ calculation: sheet.calculation });
    await request;
    expect(c.getSnapshot().input.productSku).toBe("OTHER");
    expect(c.getSnapshot().preview).toBeNull();
  });
  it("does not publish late mutation JSON after disposal and reactivation", async () => {
    const body = deferred<unknown>();
    const fetcher = vi.fn<typeof fetch>(async () => ({ ok: true, json: () => body.promise }) as Response);
    const c = new CostSheetController(input, fetcher);
    const action = c.save();
    await Promise.resolve();
    c.dispose();
    c.activate();
    body.resolve({ sheet });
    await action;
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(c.getSnapshot().notice).toBeNull();
    expect(c.getSnapshot().pending).not.toBeNull();
  });
  it.each([401, 403])("clears sensitive loaded data on authorization denial %s", async status => {
    let denied = false;
    const c = new CostSheetController(input, vi.fn<typeof fetch>(async () => denied ? json({ error: "Denied" }, status) : json({ sheet })));
    await c.load("s1");
    denied = true;
    await c.preview();
    expect(c.getSnapshot().saved).toBeNull();
    expect(c.getSnapshot().preview).toBeNull();
    expect(c.canFinalize()).toBe(false);
    expect(c.getSnapshot().error).toBe("Denied");
  });
  it("a 409 rejects the stale version without claiming success", async () => {
    const requests: RequestInit[] = [];
    const c = new CostSheetController(input, vi.fn<typeof fetch>(async (_url, options) => {
      requests.push(options!);
      return options?.method === "PATCH" ? json({ error: "Version conflict" }, 409) : json({ sheet });
    }));
    await c.load("s1");
    await c.save("update");
    expect(JSON.parse(String(requests[1].body))).toEqual({ input, expectedVersion: 1 });
    expect(c.getSnapshot().pending).toBeNull();
    expect(c.getSnapshot().notice).toBeNull();
    expect(c.getSnapshot().error).toBe("Version conflict");
  });
  it("keeps an accepted write unresolved when same-version saved readback is corrupt", async () => {
    const c = new CostSheetController(input, vi.fn<typeof fetch>(async (_url, options) => json({ sheet: options?.method === "POST" ? sheet : { ...sheet, calculation: { ...sheet.calculation, totals: {} } } })));
    await c.save();
    expect(c.getSnapshot().pending).not.toBeNull();
    expect(c.getSnapshot().saved).toBeNull();
    expect(c.getSnapshot().notice).toBeNull();
    expect(c.getSnapshot().error).toBe("Saved snapshot readback failed");
  });
  it("reconciles an accepted replay advanced by another writer without replacing inputs or creating duplicate writes", async () => {
    const currentInput = { ...input, batchQty: "7" };
    const current = { ...sheet, version: 2, calculation: calculateCostSheet(currentInput, facts) };
    const writes: RequestInit[] = [];
    const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
      if (options?.method === "POST") { writes.push(options); if (writes.length === 1) throw new Error("Lost response"); return json({ sheet }); }
      return json({ sheet: current });
    });
    const c = new CostSheetController(input, fetcher);
    await c.save();
    await c.retry();
    expect(writes[1].body).toBe(writes[0].body);
    expect(writes[1].headers).toEqual(writes[0].headers);
    expect(c.getSnapshot().pending).toBeNull();
    expect(c.getSnapshot().notice).toBe("advanced");
    expect(c.getSnapshot().input).toEqual(input);
    expect(c.getSnapshot().saved).toBeNull();
    expect(c.canFinalize()).toBe(false);
    await c.save();
    expect(writes).toHaveLength(2);
    await c.loadCurrent();
    expect(c.getSnapshot().saved).toEqual(current);
    expect(c.getSnapshot().input).toEqual(currentInput);
    expect(c.getSnapshot().notice).toBeNull();
    expect(writes).toHaveLength(2);
  });
  it.each([
    ["different ID", { ...sheet, id: "foreign", version: 2 }],
    ["different SKU", { ...sheet, productSku: "OTHER", version: 2 }],
    ["different revision", { ...sheet, revision: 2, version: 2 }],
    ["different creator", { ...sheet, createdBy: "foreign", version: 2 }],
    ["different parent", { ...sheet, supersedesId: "foreign", version: 2 }],
    ["corrupt calculation", { ...sheet, version: 2, calculation: { ...sheet.calculation, totals: {} } }],
    ["same-version changed calculation", { ...sheet, calculation: calculateCostSheet({ ...input, batchQty: "7" }, facts) }],
  ])("retains unknown intent on %s instead of offering advancement recovery", async (_name, current) => {
    const c = new CostSheetController(input, vi.fn<typeof fetch>(async (_url, options) => json({ sheet: options?.method === "POST" ? sheet : current })));
    await c.save();
    expect(c.getSnapshot().pending).not.toBeNull();
    expect(c.getSnapshot().advanced).toBeNull();
    expect(c.getSnapshot().notice).toBeNull();
    expect(c.getSnapshot().error).toBe("Saved snapshot readback failed");
  });
  it("an older version cannot resolve an accepted update", async () => {
    const accepted = { ...sheet, version: 2 };
    const c = new CostSheetController(input, vi.fn<typeof fetch>(async (_url, options) => json({ sheet: options?.method === "PATCH" ? accepted : sheet })));
    await c.load(sheet.id);
    await c.save("update");
    expect(c.getSnapshot().pending).not.toBeNull();
    expect(c.getSnapshot().notice).toBeNull();
    expect(c.getSnapshot().advanced).toBeNull();
  });
  it.each([401, 403])("advanced recovery requires fresh authorization before loading inputs (%s)", async status => {
    let denied = false;
    const c = new CostSheetController(input, vi.fn<typeof fetch>(async (_url, options) => denied ? json({ error: "Denied" }, status) : json({ sheet: options?.method === "POST" ? sheet : { ...sheet, version: 2 } })));
    await c.save();
    expect(c.getSnapshot().advanced).not.toBeNull();
    denied = true;
    await c.loadCurrent();
    expect(c.getSnapshot().saved).toBeNull();
    expect(c.getSnapshot().advanced).toBeNull();
    expect(c.getSnapshot().input).toEqual(input);
    expect(c.getSnapshot().error).toBe("Denied");
  });
  it.each([
    ["older", { ...sheet, version: 1 }],
    ["wrong identity", { ...sheet, id: "other", version: 3 }],
    ["corrupt", { ...sheet, version: 3, calculation: null }],
  ])("current-snapshot loading remains recoverable after %s readback without replacing inputs", async (_name, bad) => {
    let next: unknown = { ...sheet, version: 2 };
    const fetcher = vi.fn<typeof fetch>(async (_url, options) => json({ sheet: options?.method === "POST" ? sheet : next }));
    const c = new CostSheetController(input, fetcher);
    await c.save();
    next = bad;
    await c.loadCurrent();
    expect(c.getSnapshot().advanced).not.toBeNull();
    expect(c.getSnapshot().saved).toBeNull();
    expect(c.getSnapshot().input).toEqual(input);
    expect(c.getSnapshot().error).toBe("Saved snapshot readback failed");
    next = { ...sheet, version: 3 };
    await c.loadCurrent();
    expect(c.getSnapshot().advanced).toBeNull();
    expect(c.getSnapshot().saved?.version).toBe(3);
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  });
  it("loads a concurrently finalized current snapshot without treating its calculation as the accepted one", async () => {
    const current = { ...sheet, version: 3, status: "Finalized", finalizedAt: "2026-10-23T01:00:00Z", finalizedBy: "other" };
    const c = new CostSheetController(input, vi.fn<typeof fetch>(async (_url, options) => json({ sheet: options?.method === "POST" ? sheet : current })));
    await c.save();
    expect(c.getSnapshot().notice).toBe("advanced");
    expect(c.getSnapshot().saved).toBeNull();
    await c.loadCurrent();
    expect(c.getSnapshot().saved?.status).toBe("Finalized");
    expect(c.canFinalize()).toBe(false);
  });
  it("publishes success only after matching readback and then finalizes the saved version", async () => {
    const requests: { url: string; options?: RequestInit }[] = [];
    let current = sheet;
    const c = new CostSheetController(input, vi.fn<typeof fetch>(async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).endsWith("/finalize")) current = { ...sheet, status: "Finalized", version: 2, finalizedAt: "2026-10-23T01:00:00Z", finalizedBy: "U" };
      return json({ sheet: current });
    }));
    await c.save();
    expect(c.getSnapshot().notice).toBe("saved");
    expect(c.getSnapshot().pending).toBeNull();
    await c.finalize();
    expect(requests[2].url).toBe("/api/cost-sheets/s1/finalize");
    expect(JSON.parse(String(requests[2].options?.body))).toEqual({ expectedVersion: 1 });
    expect(c.getSnapshot().saved?.status).toBe("Finalized");
    expect(requests).toHaveLength(4);
  });
  it("retains exact intent/key after an unknown outcome and prevents edits/double submission", async () => {
    const requests: RequestInit[] = [];
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => { requests.push(init!); throw new Error("lost response"); });
    const c = new CostSheetController(input, fetcher);
    const action = c.save();
    await c.save();
    await action;
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(c.getSnapshot().pending).not.toBeNull();
    expect(c.edit({ ...input, batchQty: "3" })).toBe(false);
    await c.retry();
    expect(requests[1].body).toBe(requests[0].body);
    expect(requests[1].headers).toEqual(requests[0].headers);
  });
  it("requires explicit preview/update after approving a rate before finalization", async () => {
    const c = new CostSheetController(input, vi.fn<typeof fetch>(async url => String(url).includes("standard-rates") ? json({ rate: { id: "r1" } }) : json({ sheet })));
    await c.load("s1");
    expect(c.canFinalize()).toBe(true);
    await c.approve({ sku: "RM", uom: "KG", rate: "0", effectiveDate: input.asOfDate, reason: "Approved free issue" });
    expect(c.canFinalize()).toBe(false);
  });
});
