import { describe, expect, it } from "vitest";
import { serializeTallyExport, type TallyExportInput } from "../src/lib/accounts/tally-export";

function fixture(): TallyExportInput {
  return {
    organizationId: "ORG-1",
    organizationName: "Example Works",
    fromDate: "2026-04-01",
    toDate: "2026-04-30",
    ledgers: [
      { id: "ACC-1", code: "1000", name: "Cash / Bank", type: "Asset" },
      { id: "ACC-2", code: "5100", name: "Rent Expense", type: "Expense" },
    ],
    postedJournals: [{
      id: "JE-1", date: "2026-04-15", reference: "JE-1", narration: "April rent",
      lines: [
        { accountId: "ACC-2", debitPaise: 12345, creditPaise: 0 },
        { accountId: "ACC-1", debitPaise: 0, creditPaise: 12345 },
      ],
    }],
  };
}

describe("serializeTallyExport", () => {
  it("escapes markup, quotes and legal whitespace without double escaping", () => {
    const input = fixture();
    const text = `A & <B> "quote" 'apostrophe'\t\n\r 😀 हिन्दी &amp;`;
    const escaped = "A &amp; &lt;B&gt; &quot;quote&quot; &apos;apostrophe&apos;&#9;&#10;&#13; 😀 हिन्दी &amp;amp;";
    const result = serializeTallyExport({ ...input, organizationName: text,
      ledgers: [{ ...input.ledgers[0], name: text }, input.ledgers[1]],
      postedJournals: [{ ...input.postedJournals[0], id: text, reference: text, narration: text }],
    });
    expect(result.mastersXml).toContain(`<NAME>${escaped}</NAME>`);
    expect(result.vouchersXml).toContain(`<LEDGERNAME>${escaped}</LEDGERNAME>`);
    expect(result.vouchersXml).toContain(`<REFERENCE>${escaped}</REFERENCE>`);
    expect(result.vouchersXml).toContain(`<NARRATION>${escaped}</NARRATION>`);
    expect(result.vouchersXml).toContain(`<VOUCHERNUMBER>${escaped}</VOUCHERNUMBER>`);
    expect(result.mastersXml).toContain(`<SVCURRENTCOMPANY>${escaped}</SVCURRENTCOMPANY>`);
  });

  it("rejects XML 1.0 forbidden controls, noncharacters and lone surrogates", () => {
    const input = fixture();
    for (const bad of ["\u0000", "\u0001", "\u0008", "\u000b", "\u000c", "\u001f", "\ufffe", "\uffff", "\ud800", "\udc00"]) {
      expect(() => serializeTallyExport({ ...input, organizationName: `Company${bad}` })).toThrow(/XML character/i);
      expect(() => serializeTallyExport({ ...input, postedJournals: [{ ...input.postedJournals[0], narration: bad }] })).toThrow(/XML character/i);
    }
  });

  it("validates all textual fields including non-emitted identities and out-of-range narration", () => {
    const input = fixture();
    for (const bad of [
      { ...input, organizationId: "ORG\u0000" },
      { ...input, ledgers: [{ ...input.ledgers[0], id: "A\u0000" }, input.ledgers[1]] },
      { ...input, ledgers: [{ ...input.ledgers[0], code: "1\u0000" }, input.ledgers[1]] },
      { ...input, postedJournals: [{ ...input.postedJournals[0], date: "2026-03-01", narration: "\u0000" }] },
      { ...input, postedJournals: [{ ...input.postedJournals[0], narration: null }] },
    ]) expect(() => serializeTallyExport(bad as unknown as TallyExportInput)).toThrow(/XML|text/i);
  });

  it("requires strict real Gregorian dates without timezone coercion", () => {
    const input = fixture();
    for (const date of ["", " ", "2026-4-01", "2026-02-29", "1900-02-29", "2026-04-31", "0000-01-01", "2026-04-15T00:00:00Z", "2026-13-01"]) {
      expect(() => serializeTallyExport({ ...input, fromDate: date })).toThrow(/date/i);
      expect(() => serializeTallyExport({ ...input, toDate: date })).toThrow(/date/i);
      expect(() => serializeTallyExport({ ...input, postedJournals: [{ ...input.postedJournals[0], date }] })).toThrow(/date/i);
    }
    const leap = serializeTallyExport({ ...input, fromDate: "2000-02-29", toDate: "2000-02-29",
      postedJournals: [{ ...input.postedJournals[0], date: "2000-02-29" }],
    });
    expect(leap.vouchersXml).toContain("<DATE>20000229</DATE>");
  });

  it("rejects reversed date ranges", () => {
    expect(() => serializeTallyExport({ ...fixture(), fromDate: "2026-05-01" })).toThrow(/date range/i);
  });

  it("selects both inclusive date boundaries and excludes outside journals", () => {
    const input = fixture();
    const dates = ["2026-03-31", "2026-04-01", "2026-04-30", "2026-05-01"];
    const result = serializeTallyExport({ ...input, postedJournals: dates.map((date) => ({ ...input.postedJournals[0], id: date, date })) });
    expect(result.voucherCount).toBe(2);
    expect(result.vouchersXml).toContain("<DATE>20260401</DATE>");
    expect(result.vouchersXml).toContain("<DATE>20260430</DATE>");
    expect(result.vouchersXml).not.toContain("<DATE>20260331</DATE>");
    expect(result.vouchersXml).not.toContain("<DATE>20260501</DATE>");
  });

  it("rejects corrupt money outside the date range", () => {
    const input = fixture();
    expect(() => serializeTallyExport({ ...input, postedJournals: [{ ...input.postedJournals[0], date: "2026-03-01", lines: [
      { accountId: "ACC-1", debitPaise: NaN, creditPaise: 0 }, input.postedJournals[0].lines[1],
    ] }] })).toThrow(/paise/i);
  });

  it("emits stable UUID GUIDs and matching voucher REMOTEID scoped by organization and kind", () => {
    const input = fixture();
    const result = serializeTallyExport(input);
    const guid = result.vouchersXml.match(/<GUID>([^<]+)<\/GUID>/)?.[1];
    expect(guid).toMatch(/^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    // Independently calculated with Python stdlib uuid.uuid5(NAMESPACE_DNS, JSON identity).
    expect(guid).toBe("1da7c0a9-d9e2-5c58-a840-154013880b41");
    expect(result.vouchersXml).toContain(`REMOTEID="${guid}"`);
    const guids = [...result.mastersXml.matchAll(/<GUID>([^<]+)<\/GUID>/g)].map((match) => match[1]);
    expect(guids).toHaveLength(2);
    expect(new Set([...guids, guid]).size).toBe(3);
    expect(serializeTallyExport(input)).toEqual(result);
    expect(serializeTallyExport({ ...input, organizationId: "ORG-2" }).vouchersXml).not.toContain(`<GUID>${guid}</GUID>`);
    const renamed = serializeTallyExport({ ...input, organizationName: "New name", postedJournals: [{ ...input.postedJournals[0], reference: "Other ref" }] });
    expect(renamed.vouchersXml).toContain(`<GUID>${guid}</GUID>`);
    const sameId = serializeTallyExport({ ...input, postedJournals: [{ ...input.postedJournals[0], id: "ACC-1" }] });
    expect(sameId.vouchersXml).not.toContain(`<GUID>${guids[0]}</GUID>`);
  });

  it("sorts masters and vouchers deterministically without mutating input", () => {
    const input = fixture();
    const journals = [input.postedJournals[0], { ...input.postedJournals[0], id: "JE-2", date: "2026-04-01" }];
    const before = JSON.stringify({ ...input, postedJournals: journals });
    const result = serializeTallyExport({ ...input, postedJournals: journals });
    expect(serializeTallyExport({ ...input, ledgers: [...input.ledgers].reverse(), postedJournals: [...journals].reverse() })).toEqual(result);
    expect(result.vouchersXml.indexOf("<DATE>20260401</DATE>")).toBeLessThan(result.vouchersXml.indexOf("<DATE>20260415</DATE>"));
    expect(JSON.stringify({ ...input, postedJournals: journals })).toBe(before);
  });

  it("supports empty exports without fabricating opening balances or vouchers", () => {
    const result = serializeTallyExport({ ...fixture(), ledgers: [], postedJournals: [] });
    expect(result.ledgerCount).toBe(0);
    expect(result.voucherCount).toBe(0);
    expect(result.mastersXml).toContain("<REQUESTDATA></REQUESTDATA>");
    expect(result.vouchersXml).toContain("<REQUESTDATA></REQUESTDATA>");
    expect(result.mastersXml).not.toContain("OPENINGBALANCE");
  });
  it("rejects unknown ledger references even outside the selected range", () => {
    const input = fixture();
    for (const date of ["2026-04-15", "2026-03-01"]) {
      expect(() => serializeTallyExport({ ...input, postedJournals: [{ ...input.postedJournals[0], date,
        lines: [{ accountId: "MISSING", debitPaise: 12345, creditPaise: 0 }, input.postedJournals[0].lines[1]],
      }] })).toThrow(/unknown ledger/i);
    }
  });

  it("rejects duplicate ledger IDs, codes and case-insensitive names", () => {
    const input = fixture();
    for (const duplicate of [
      { ...input.ledgers[1], id: "ACC-1" },
      { ...input.ledgers[1], code: "1000" },
      { ...input.ledgers[1], name: "  cash / BANK  " },
    ]) {
      expect(() => serializeTallyExport({ ...input, ledgers: [input.ledgers[0], duplicate] })).toThrow(/duplicate ledger/i);
    }
  });

  it("rejects unknown account types including object prototype keys", () => {
    const input = fixture();
    for (const type of ["Unknown", "toString", "__proto__", ["Asset"], null, undefined]) {
      expect(() => serializeTallyExport({ ...input, ledgers: [{ ...input.ledgers[0], type }, input.ledgers[1]] } as unknown as TallyExportInput)).toThrow(/account type/i);
    }
  });

  it("maps all five account types to explicit documented predefined groups", () => {
    const input = fixture();
    const types = ["Asset", "Liability", "Equity", "Income", "Expense"] as const;
    const ledgers = types.map((type) => ({ id: type, code: type, name: type, type }));
    const result = serializeTallyExport({ ...input, ledgers, postedJournals: [] });
    for (const [name, parent] of [
      ["Asset", "Current Assets"], ["Liability", "Current Liabilities"], ["Equity", "Capital Account"],
      ["Income", "Indirect Incomes"], ["Expense", "Indirect Expenses"],
    ]) expect(result.mastersXml).toContain(`<NAME>${name}</NAME><PARENT>${parent}</PARENT>`);
  });

  it("rejects duplicate journal identities", () => {
    const input = fixture();
    expect(() => serializeTallyExport({ ...input, postedJournals: [input.postedJournals[0], input.postedJournals[0]] })).toThrow(/duplicate journal/i);
  });

  it("requires nonempty organization, ledger and journal identity/reference fields", () => {
    const input = fixture();
    const badInputs: TallyExportInput[] = [
      ...["organizationId", "organizationName"].map((key) => ({ ...input, [key]: "  " })),
      ...["id", "code", "name"].map((key) => ({ ...input, ledgers: [{ ...input.ledgers[0], [key]: " " }, input.ledgers[1]] })),
      ...["id", "reference"].map((key) => ({ ...input, postedJournals: [{ ...input.postedJournals[0], [key]: " " }] })),
    ];
    for (const bad of badInputs) expect(() => serializeTallyExport(bad)).toThrow(/nonempty/i);
  });

  it("rejects malformed arrays and null records rather than serializing partial data", () => {
    const input = fixture();
    for (const bad of [
      { ...input, ledgers: null }, { ...input, postedJournals: null },
      { ...input, ledgers: [null] }, { ...input, postedJournals: [null] },
      { ...input, postedJournals: [{ ...input.postedJournals[0], lines: [null, null] }] },
    ]) expect(() => serializeTallyExport(bad as unknown as TallyExportInput)).toThrow();
  });
  it.each([
    ["fractional paise", 1.25], ["negative paise", -1], ["NaN", NaN],
    ["infinity", Infinity], ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
    ["numeric string", "12345"], ["missing operand", undefined], ["null operand", null],
  ])("rejects corrupt money: %s", (_label, value) => {
    const input = fixture();
    const lines = [{ accountId: "ACC-2", debitPaise: value, creditPaise: 0 }, input.postedJournals[0].lines[1]];
    expect(() => serializeTallyExport({ ...input, postedJournals: [{ ...input.postedJournals[0], lines }] } as TallyExportInput)).toThrow(/paise/i);
  });

  it.each([
    ["both sides", 12345, 12345], ["neither side", 0, 0],
  ])("rejects journal line with %s", (_label, debitPaise, creditPaise) => {
    const input = fixture();
    expect(() => serializeTallyExport({ ...input, postedJournals: [{ ...input.postedJournals[0], lines: [
      { accountId: "ACC-2", debitPaise, creditPaise }, input.postedJournals[0].lines[1],
    ] }] })).toThrow(/one positive/i);
  });

  it("rejects unbalanced journals without rounding", () => {
    const input = fixture();
    expect(() => serializeTallyExport({ ...input, postedJournals: [{ ...input.postedJournals[0], lines: [
      input.postedJournals[0].lines[0], { accountId: "ACC-1", debitPaise: 0, creditPaise: 12344 },
    ] }] })).toThrow(/unbalanced/i);
  });

  it("rejects fewer than two journal lines", () => {
    const input = fixture();
    expect(() => serializeTallyExport({ ...input, postedJournals: [{ ...input.postedJournals[0], lines: [] }] })).toThrow(/two lines/i);
  });

  it("balances sums beyond Number precision using exact integer paise", () => {
    const input = fixture();
    const line = (debitPaise: number, creditPaise: number) => ({ accountId: "ACC-1", debitPaise, creditPaise });
    const journal = { ...input.postedJournals[0], lines: [
      line(Number.MAX_SAFE_INTEGER, 0), line(2, 0),
      line(0, Number.MAX_SAFE_INTEGER), line(0, 1),
    ] };
    expect(() => serializeTallyExport({ ...input, postedJournals: [journal] })).toThrow(/unbalanced/i);
    const balanced = { ...journal, lines: [...journal.lines.slice(0, 3), line(0, 2)] };
    expect(serializeTallyExport({ ...input, postedJournals: [balanced] }).vouchersXml)
      .toContain("<AMOUNT>-90071992547409.91</AMOUNT>");
  });

  it("formats one paise and whole rupees without floating point", () => {
    const input = fixture();
    for (const [paise, expected] of [[1, "0.01"], [100, "1.00"]] as const) {
      const journal = { ...input.postedJournals[0], lines: [
        { accountId: "ACC-1", debitPaise: paise, creditPaise: 0 },
        { accountId: "ACC-2", debitPaise: 0, creditPaise: paise },
      ] };
      expect(serializeTallyExport({ ...input, postedJournals: [journal] }).vouchersXml).toContain(`<AMOUNT>-${expected}</AMOUNT>`);
    }
  });
  it("emits separate master and Journal import envelopes with documented debit/credit signs", () => {
    const result = serializeTallyExport(fixture());
    expect(result.ledgerCount).toBe(2);
    expect(result.voucherCount).toBe(1);
    expect(result.mastersXml).toContain("<REPORTNAME>All Masters</REPORTNAME>");
    expect(result.mastersXml).toContain("<NAME>Cash / Bank</NAME><PARENT>Current Assets</PARENT>");
    expect(result.mastersXml).toContain("<NAME>Rent Expense</NAME><PARENT>Indirect Expenses</PARENT>");
    expect(result.mastersXml).not.toContain("<VOUCHER ");
    expect(result.vouchersXml).toContain("<REPORTNAME>Vouchers</REPORTNAME>");
    expect(result.vouchersXml).toContain("<SVCURRENTCOMPANY>Example Works</SVCURRENTCOMPANY>");
    expect(result.vouchersXml).toContain('VCHTYPE="Journal" ACTION="Create" OBJVIEW="Accounting Voucher View"');
    expect(result.vouchersXml).toContain("<DATE>20260415</DATE>");
    expect(result.vouchersXml).toContain("<VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>");
    expect(result.vouchersXml).toContain("<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW><ISINVOICE>No</ISINVOICE>");
    expect(result.vouchersXml).toContain("<REFERENCE>JE-1</REFERENCE><NARRATION>April rent</NARRATION>");
    expect(result.vouchersXml).toContain("<LEDGERNAME>Rent Expense</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-123.45</AMOUNT>");
    expect(result.vouchersXml).toContain("<LEDGERNAME>Cash / Bank</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>123.45</AMOUNT>");
    expect(result.vouchersXml).not.toMatch(/ALLINVENTORY|GST|BILLALLOCATIONS/);
    expect(result.vouchersXml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
  });
});
