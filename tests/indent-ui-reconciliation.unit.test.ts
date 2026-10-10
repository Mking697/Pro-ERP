import { describe, expect, it } from "vitest";
import { boardHarness } from "./helpers/indent-board-harness";

const savedA = { Indent_ID: "IND-A", SKU: "A" };
const mixed = { created: 1, indents: [savedA], failed: [{ sku: "B", error: "Ban nahi paya." }], committed: true };

describe("actual reorder indent caller reconciliation", () => {
  it.each([400, 500])("retains all confirmed failed selections and quantities on HTTP %s", async (status) => {
    const body = { created: 0, indents: [], failed: [{ sku: "A", error: "Rejected" }, { sku: "B", error: "Rejected" }] };
    const board = boardHarness([{ status, body }]);
    await board.raise();
    expect(board.state[2]).toEqual({ A: true, B: true });
    expect(board.state[3]).toEqual({ A: "3", B: "4" });
    expect(board.toast.success).not.toHaveBeenCalled();
    expect(board.toast.error).toHaveBeenCalledWith("2 nahi bane: A, B");
    expect(board.render().find((element) => element.type === "Button")?.props.disabled).toBe(false);
  });
  it("reconciles an ordinary HTTP 200 success", async () => {
    const board = boardHarness([{ status: 200, body: { created: 2, indents: [savedA, { SKU: "B", Indent_ID: "IND-B" }], failed: [] } }]);
    await board.raise();
    expect(board.state[2]).toEqual({});
    expect(board.state[3]).toEqual({});
    expect(board.state[6]).toBe(1);
    expect(board.toast.success).toHaveBeenCalledWith("2 indent ban gaye.");
    expect(board.toast.error).not.toHaveBeenCalled();
    expect(board.toast.warning).not.toHaveBeenCalled();
  });
  it.each([200, 400])("retains only typed failures in a partial HTTP %s result", async (status) => {
    const board = boardHarness([{ status, body: { ...mixed, committed: undefined } }]);
    await board.raise();
    expect(board.state[2]).toEqual({ B: true });
    expect(board.state[3]).toEqual({ B: "4" });
    expect(board.state[6]).toBe(1);
    expect(board.toast.success).toHaveBeenCalledWith("1 indent ban gaye.");
    expect(board.toast.error).toHaveBeenCalledWith("1 nahi bane: B");
  });
  it("blocks retry after a network failure without fabricating a committed result", async () => {
    const board = boardHarness([new Error("network disconnected")]);
    await board.raise();
    expect(board.state[2]).toEqual({ A: true, B: true });
    expect(board.toast.success).not.toHaveBeenCalled();
    expect(board.toast.warning).not.toHaveBeenCalled();
    const tree = board.render();
    expect(tree.find((element) => element.type === "Button")?.props.disabled).toBe(true);
    expect(tree.some((element) => element.type === "p" && String(element.props.children).includes("confirm nahi hua"))).toBe(true);
    expect(tree.some((element) => element.type === "default" && (element.props as { href?: string }).href === "/inventory/indents")).toBe(true);
    await tree.find((element) => element.type === "Button")!.props.onClick!();
    expect(board.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    null,
    { created: 2, committed: true },
    { created: 2, indents: [{ SKU: "A" }, { SKU: "B" }], failed: [] },
    { created: 1, indents: [savedA], failed: [{ sku: "A" }] },
    { created: 1, indents: [savedA], failed: "malformed" },
    { created: 2, indents: [savedA], failed: [{ sku: "B", error: "Rejected" }] },
    { created: 1, indents: [savedA], failed: [] },
    { created: 2, indents: [savedA, { SKU: "B", Indent_ID: "IND-A" }], failed: [] },
    { created: 2, indents: [savedA, { SKU: "outside-request", Indent_ID: "OTHER" }], failed: [] },
  ])("blocks blind retry of an unknown or malformed response (%j) without fabricating success", async (body) => {
    const board = boardHarness([{ status: 500, body }]);
    await board.raise();
    expect(board.toast.success).not.toHaveBeenCalled();
    expect(board.state[2]).toEqual({ A: true, B: true });
    expect(board.render().find((element) => element.type === "Button")?.props.disabled).toBe(true);
    expect(board.toast.error).toHaveBeenCalledWith("Indent result confirm nahi hua. Indents list check karein; bina verify kiye dobara submit na karein.");
  });
  it("shows a sanitized confirmed-commit warning instead of treating cleanup as rollback", async () => {
    const board = boardHarness([{ status: 200, body: { ...mixed, warnings: [{ sku: "A", warning: "secret DATABASE_URL cleanup detail" }] } }]);
    await board.raise();
    expect(board.toast.warning).toHaveBeenCalledWith("Saved indents confirmed hain; server issue hua. Saved items dobara submit na karein.");
    expect(JSON.stringify(board.toast.warning.mock.calls)).not.toContain("DATABASE_URL");
    expect(board.state[2]).toEqual({ B: true });
  });
  it("consumes saved siblings on mixed HTTP 500 and excludes them from the next request", async () => {
    const board = boardHarness([{ status: 500, body: mixed }, { status: 400, body: { created: 0, indents: [], failed: [{ sku: "B", error: "Invalid quantity" }] } }]);
    await board.raise();
    expect(board.state[2]).toEqual({ B: true });
    expect(board.state[3]).toEqual({ B: "4" });
    expect(board.state[6]).toBe(1);
    expect(board.toast.success).toHaveBeenCalledWith("1 indent ban gaye.");
    expect(board.toast.error).toHaveBeenCalledWith("1 nahi bane: B");
    await board.raise();
    expect(board.payloadSkus(0)).toEqual(["A", "B"]);
    expect(board.payloadSkus(1)).toEqual(["B"]);
  });
  it("blocks retry for a typed unknown outcome without treating it as saved or failed", async () => {
    const body = { created: 1, indents: [savedA], failed: [], unknown: [{ sku: "B", error: "Result confirm nahi hua." }], committed: true };
    const board = boardHarness([{ status: 500, body }]);
    await board.raise();
    // A is saved and consumed; B's result is unknown, so it must stay selected and
    // retry must be blocked — never silently retried, never silently dropped.
    expect(board.state[2]).toEqual({ B: true });
    expect(board.state[3]).toEqual({ B: "4" });
    expect(board.toast.success).toHaveBeenCalledWith("1 indent ban gaye.");
    expect(board.render().find((element) => element.type === "Button")?.props.disabled).toBe(true);
  });
  it("blocks retry and fabricates no success when every sibling's outcome is unknown", async () => {
    const body = { created: 0, indents: [], failed: [], unknown: [{ sku: "A", error: "x" }, { sku: "B", error: "x" }] };
    const board = boardHarness([{ status: 500, body }]);
    await board.raise();
    expect(board.toast.success).not.toHaveBeenCalled();
    expect(board.state[2]).toEqual({ A: true, B: true });
    expect(board.render().find((element) => element.type === "Button")?.props.disabled).toBe(true);
  });
});
