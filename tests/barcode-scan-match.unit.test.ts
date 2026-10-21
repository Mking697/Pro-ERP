import { describe, expect, it } from "vitest";
import {
  isChecklistComplete,
  matchRowByScan,
  matchSkuByScan,
  normalizeScanValue,
  uniqueSkus,
} from "@/lib/scan/match";

// Pure logic only — the camera/video decode itself is not meaningfully unit-testable
// without a real device, per this task's own instructions. These cover the SKU-matching
// and checklist-completion rules shared by the Inventory, Dispatch and Purchase General
// PO Receive scan integrations.

describe("normalizeScanValue", () => {
  it("trims surrounding whitespace a label scan can add", () => {
    expect(normalizeScanValue("  SKU-001  \n")).toBe("SKU-001");
  });
});

describe("matchSkuByScan", () => {
  const skus = ["SKU-001", "SKU-002", "Raw-Material-X"];

  it("matches an exact SKU", () => {
    expect(matchSkuByScan(skus, "SKU-001")).toBe("SKU-001");
  });

  it("matches case-insensitively and trims whitespace", () => {
    expect(matchSkuByScan(skus, "  sku-002  ")).toBe("SKU-002");
  });

  it("never matches a substring of a real SKU", () => {
    expect(matchSkuByScan(skus, "SKU-00")).toBeNull();
  });

  it("returns null for an empty or unmatched scan", () => {
    expect(matchSkuByScan(skus, "")).toBeNull();
    expect(matchSkuByScan(skus, "   ")).toBeNull();
    expect(matchSkuByScan(skus, "NO-SUCH-SKU")).toBeNull();
  });
});

describe("matchRowByScan", () => {
  it("matches a row whose SKU-holding candidate (General PO description) equals the scan", () => {
    const rows = [
      { id: "line-1", candidates: ["SKU-100", "Steel Rod"] },
      { id: "line-2", candidates: ["", "Free text particular with no real SKU"] },
    ];
    expect(matchRowByScan(rows, "sku-100")?.id).toBe("line-1");
  });

  it("falls back to the particular candidate when description is empty", () => {
    const rows = [{ id: "line-2", candidates: ["", "Free text particular with no real SKU"] }];
    expect(matchRowByScan(rows, "Free text particular with no real SKU")?.id).toBe("line-2");
  });

  it("ignores an empty candidate string so it cannot false-match an empty scan", () => {
    const rows = [{ id: "line-2", candidates: [""] }];
    expect(matchRowByScan(rows, "")).toBeNull();
  });

  it("returns null when nothing matches", () => {
    const rows = [{ id: "line-1", candidates: ["SKU-100"] }];
    expect(matchRowByScan(rows, "SKU-999")).toBeNull();
  });
});

describe("uniqueSkus", () => {
  it("de-dupes repeated SKUs across multiple shipment lines", () => {
    expect(uniqueSkus(["SKU-1", "SKU-2", "SKU-1"])).toEqual(["SKU-1", "SKU-2"]);
  });

  it("returns an empty list for an empty shipment", () => {
    expect(uniqueSkus([])).toEqual([]);
  });
});

describe("isChecklistComplete", () => {
  it("is false until every required SKU has been scanned/ticked", () => {
    const required = ["SKU-1", "SKU-2"];
    expect(isChecklistComplete(required, new Set(["SKU-1"]))).toBe(false);
    expect(isChecklistComplete(required, new Set(["SKU-1", "SKU-2"]))).toBe(true);
  });

  it("is false for an empty required list (nothing to verify should never read as 'done')", () => {
    expect(isChecklistComplete([], new Set())).toBe(false);
  });

  it("ignores extra scanned SKUs that are not part of this shipment", () => {
    expect(isChecklistComplete(["SKU-1"], new Set(["SKU-1", "SKU-unrelated"]))).toBe(true);
  });
});
