import { createHash } from "node:crypto";

export type TallyAccountType = "Asset" | "Liability" | "Equity" | "Income" | "Expense";
export interface TallyLedger {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: TallyAccountType;
}
export interface TallyJournalLine {
  readonly accountId: string;
  readonly debitPaise: number;
  readonly creditPaise: number;
}
export interface TallyPostedJournal {
  readonly id: string;
  /** Business day, strictly YYYY-MM-DD; caller converts DB instants to IST. */
  readonly date: string;
  readonly reference: string;
  readonly narration: string;
  readonly lines: readonly TallyJournalLine[];
}
export interface TallyExportInput {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly ledgers: readonly TallyLedger[];
  /** Persisted GL entries only (the GL has no Draft status). No invoice objects. */
  readonly postedJournals: readonly TallyPostedJournal[];
}
export interface TallyExportResult {
  readonly mastersXml: string;
  readonly vouchersXml: string;
  readonly ledgerCount: number;
  readonly voucherCount: number;
}
// Official primary references (reviewed for this GL-only format):
// https://help.tallysolutions.com/sample-xml
// https://help.tallysolutions.com/xml-integration/
// https://help.tallysolutions.com/ledgers-and-groups-in-tallyprime
// https://help.tallysolutions.com/import-data-faq/
// These are coarse V1 classification defaults, NOT inferred account subtypes:
// the source chart cannot distinguish fixed/current, trade/nontrade or direct/indirect.
const GROUP_BY_TYPE: Record<TallyAccountType, string> = {
  Asset: "Current Assets", Liability: "Current Liabilities", Equity: "Capital Account",
  Income: "Indirect Incomes", Expense: "Indirect Expenses",
};

function envelope(report: string, company: string, messages: string): string {
  return '<?xml version="1.0" encoding="UTF-8"?>' +
    '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA>' +
    `<REQUESTDESC><REPORTNAME>${report}</REPORTNAME><STATICVARIABLES>` +
    `<SVCURRENTCOMPANY>${xml(company)}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC>` +
    `<REQUESTDATA>${messages}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
}

function nonempty(value: string, label: string): void {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be nonempty`);
  validText(value);
}

function validText(value: string): void {
  if (typeof value !== "string") throw new Error("XML text must be a string");
  for (const character of value) {
    const point = character.codePointAt(0)!;
    // XML 1.0 Fifth Edition Char production; iteration keeps valid surrogate pairs.
    if (!(point === 0x9 || point === 0xa || point === 0xd ||
      (point >= 0x20 && point <= 0xd7ff) || (point >= 0xe000 && point <= 0xfffd) ||
      (point >= 0x10000 && point <= 0x10ffff))) {
      throw new Error("Invalid XML character");
    }
  }
}

function xml(value: string): string {
  validText(value);
  const entities: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
    "\t": "&#9;", "\n": "&#10;", "\r": "&#13;",
  };
  return value.replace(/[&<>"'\t\n\r]/g, (character) => entities[character]);
}

function validDate(value: string): void {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) {
    throw new Error("Date must be a real YYYY-MM-DD business date");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid Gregorian date");
  }
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function guid(organizationId: string, kind: "ledger" | "journal", id: string): string {
  // RFC 9562 UUIDv5, DNS namespace. Length-safe JSON identity; never hash amounts,
  // names, dates, query ranges or sequence position into a persisted record ID.
  const namespace = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex");
  const bytes = createHash("sha1").update(namespace)
    .update(JSON.stringify(["pro-erp-tally-v1", organizationId, kind, id]), "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function amount(paise: number): string {
  const value = BigInt(paise);
  const hundred = BigInt(100);
  return `${value / hundred}.${(value % hundred).toString().padStart(2, "0")}`;
}

/** Pure, DB-free GL export. Import masters BEFORE vouchers into the named company.
 * No opening balances, party/bill allocations, tax declarations or inventory invoices.
 * Real Tally import/re-import acceptance is still required; Create is not a promise
 * of idempotence under every Tally import configuration.
 */
export function serializeTallyExport(input: TallyExportInput): TallyExportResult {
  nonempty(input.organizationId, "Organization ID");
  nonempty(input.organizationName, "Organization name");
  validDate(input.fromDate);
  validDate(input.toDate);
  if (input.fromDate > input.toDate) throw new Error("Reversed date range");
  if (!Array.isArray(input.ledgers) || !Array.isArray(input.postedJournals)) {
    throw new Error("Ledgers and posted journals must be arrays");
  }
  const ledgers: readonly TallyLedger[] = input.ledgers;
  const postedJournals: readonly TallyPostedJournal[] = input.postedJournals;
  const accountById = new Map<string, TallyLedger>();
  const codes = new Set<string>();
  const names = new Set<string>();
  for (const ledger of ledgers) {
    nonempty(ledger.id, "Ledger ID");
    nonempty(ledger.code, "Ledger code");
    nonempty(ledger.name, "Ledger name");
    if (typeof ledger.type !== "string" || !Object.hasOwn(GROUP_BY_TYPE, ledger.type)) {
      throw new Error("Unknown account type");
    }
    const code = ledger.code.normalize("NFKC").trim().toLowerCase();
    const name = ledger.name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
    if (accountById.has(ledger.id) || codes.has(code) || names.has(name)) {
      throw new Error("Duplicate ledger ID, code or name");
    }
    accountById.set(ledger.id, ledger);
    codes.add(code);
    names.add(name);
  }
  const journalIds = new Set<string>();
  // Validate every supplied entry before filtering; corrupt history must not be hidden.
  for (const journal of postedJournals) {
    nonempty(journal.id, "Journal ID");
    nonempty(journal.reference, "Journal reference");
    validText(journal.narration);
    validDate(journal.date);
    if (journalIds.has(journal.id)) throw new Error("Duplicate journal ID");
    journalIds.add(journal.id);
    if (!Array.isArray(journal.lines) || journal.lines.length < 2) {
      throw new Error("Journal requires at least two lines");
    }
    let debitTotal = BigInt(0);
    let creditTotal = BigInt(0);
    for (const line of journal.lines) {
      if (!accountById.has(line.accountId)) throw new Error("Unknown ledger reference");
      for (const value of [line.debitPaise, line.creditPaise]) {
        if (!Number.isSafeInteger(value) || value < 0) {
          throw new Error("Money must be nonnegative safe integer paise");
        }
      }
      if ((line.debitPaise > 0) === (line.creditPaise > 0)) {
        throw new Error("Journal line requires exactly one positive debit or credit");
      }
      debitTotal += BigInt(line.debitPaise);
      creditTotal += BigInt(line.creditPaise);
    }
    if (debitTotal !== creditTotal) throw new Error("Unbalanced journal");
  }
  const masters = [...ledgers].sort((a, b) => compare(a.code, b.code) || compare(a.id, b.id)).map((ledger) =>
    '<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER ACTION="Create">' +
    `<NAME>${xml(ledger.name)}</NAME><PARENT>${GROUP_BY_TYPE[ledger.type]}</PARENT>` +
    `<GUID>${guid(input.organizationId, "ledger", ledger.id)}</GUID>` +
    '</LEDGER></TALLYMESSAGE>'
  ).join("");
  const journals = postedJournals.filter((journal) =>
    journal.date >= input.fromDate && journal.date <= input.toDate
  ).sort((a, b) => compare(a.date, b.date) || compare(a.id, b.id));
  const vouchers = journals.map((journal) => {
    const voucherGuid = guid(input.organizationId, "journal", journal.id);
    const lines = journal.lines.map((line) => {
      const debit = line.debitPaise > 0;
      return '<ALLLEDGERENTRIES.LIST>' +
        `<LEDGERNAME>${xml(accountById.get(line.accountId)!.name)}</LEDGERNAME>` +
        `<ISDEEMEDPOSITIVE>${debit ? "Yes" : "No"}</ISDEEMEDPOSITIVE>` +
        `<AMOUNT>${debit ? "-" : ""}${amount(debit ? line.debitPaise : line.creditPaise)}</AMOUNT>` +
        '</ALLLEDGERENTRIES.LIST>';
    }).join("");
    return '<TALLYMESSAGE xmlns:UDF="TallyUDF">' +
      `<VOUCHER REMOTEID="${voucherGuid}" VCHTYPE="Journal" ACTION="Create" OBJVIEW="Accounting Voucher View">` +
      `<DATE>${journal.date.replaceAll("-", "")}</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>` +
      `<GUID>${voucherGuid}</GUID><VOUCHERNUMBER>${xml(journal.id)}</VOUCHERNUMBER>` +
      '<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW><ISINVOICE>No</ISINVOICE>' +
      `<REFERENCE>${xml(journal.reference)}</REFERENCE><NARRATION>${xml(journal.narration)}</NARRATION>` +
      `${lines}</VOUCHER></TALLYMESSAGE>`;
  }).join("");
  return {
    mastersXml: envelope("All Masters", input.organizationName, masters),
    vouchersXml: envelope("Vouchers", input.organizationName, vouchers),
    ledgerCount: ledgers.length, voucherCount: journals.length,
  };
}
