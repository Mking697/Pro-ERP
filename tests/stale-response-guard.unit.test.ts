import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const loadGuard = require("./helpers/ux-request-guard.cjs");
for (const component of ["orders/orders-board.tsx", "accounts/accounts-board.tsx", "chat/chat-client.tsx"]) {
  describe(component, () => {
    it("ignores A after B even if transport disregards cancellation", async () => {
      const { RequestSequencer } = loadGuard(component);
      const seq = new RequestSequencer();
      let resolveA!: (data: string) => void;
      let resolveB!: (data: string) => void;
      let data = "initial";
      const a = seq.begin();
      const pa = new Promise<string>((r) => { resolveA = r; }).then((value) => { if (!seq.isStale(a.id)) data = value; });
      const b = seq.begin();
      const pb = new Promise<string>((r) => { resolveB = r; }).then((value) => { if (!seq.isStale(b.id)) data = value; });
      resolveB("B"); await pb;
      resolveA("A"); await pa;
      expect(data).toBe("B");
      expect(a.signal.aborted).toBe(true);
    });
    it("invalidates history/board completion when leaving the view", () => {
      const { RequestSequencer } = loadGuard(component);
      const seq = new RequestSequencer();
      const old = seq.begin(); seq.begin();
      expect(seq.isStale(old.id)).toBe(true);
    });
    if (!component.startsWith("chat/")) {
      for (const status of [403, 500]) it(`rejects JSON ${status} and retains last good data`, async () => {
        const { parseJsonResponse } = loadGuard(component);
        let data = ["good"];
        let error = false;
        try { const body = await parseJsonResponse({ ok: false, status, json: async () => ({ error: "no" }) }); data = body.orders ?? []; }
        catch { error = true; }
        expect(error).toBe(true);
        expect(data).toEqual(["good"]);
      });
    }
  });
}
