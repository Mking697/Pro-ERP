import { afterEach, expect, it, vi } from "vitest";
import { buildCsv, parseCsv } from "@/lib/csv";
import { downloadCsvClientSide } from "@/lib/csv-download";

afterEach(() => vi.unstubAllGlobals());

it.each(["=HYPERLINK(\"https://attacker.invalid\",\"click\")", "+SUM(1,2)", "-1+2", "@SUM(1,2)", "\t=1+2", "\r=1+2", "\n=1+2", "＝1+2", "＋1+2", "－1+2", "＠SUM(1,2)"])(
  "neutralizes untrusted party/item text %j in the real browser download", async (name) => {
    let downloaded: Blob | undefined;
    vi.stubGlobal("URL", { createObjectURL: (blob: Blob) => { downloaded = blob; return "blob:test"; }, revokeObjectURL: vi.fn() });
    const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal("document", { createElement: () => anchor, body: { appendChild: vi.fn() } });
    downloadCsvClientSide("selected.csv", [["Party / Item", "Price"], [name, -500]]);
    const cells = parseCsv(await downloaded!.text());
    expect(cells[1]).toEqual([`'${name}`, "-500"]);
    expect(anchor.click).toHaveBeenCalledOnce();
  },
);

it("already quotes separator/quote injection without creating another formula cell", () => {
  const malicious = 'name,\"\r\n=1+2';
  expect(parseCsv(buildCsv([[malicious, "-500", -500]]))).toEqual([[malicious, "'-500", "-500"]]);
});
