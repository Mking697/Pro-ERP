import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const root = resolve(import.meta.dirname, "..");
const ts = createRequire(import.meta.url)("typescript");
export const expectedTranslations = {
  "60 din se upar": "Over 60 days",
  "Aapke paas koi running step nahi hai.": "You have no running steps.",
  "Aapke running steps load nahi ho paye.": "Could not load your running steps.",
  "Abhi koi maintenance request nahi hai": "No maintenance requests yet",
  "Abhi pause hai": "Currently paused",
  "Breakdown Report Karein": "Report Breakdown",
  "Breakdown report hua — Production Line pause ho gayi.": "Breakdown reported — the Production Line has been paused.",
  "Breakdown report karte hi Production Line ka step pause ho jaata hai — jab tak aap khud confirm na karein ki line theek chal rahi hai, TAT count nahi hogi.": "Reporting a breakdown pauses the Production Line step — TAT will not be counted until you confirm that the line is running properly.",
  "Breakdown ya kisi aur kaam ke liye upar se request banayein.": "Use the controls above to create a request for a breakdown or other work.",
  "Cancel hui.": "Cancelled.",
  "Confirm hua — Line resume ho gayi.": "Confirmed — the Line has resumed.",
  "Customer se jawab chahiye": "Awaiting customer response",
  "Delivery ka intezaar": "Awaiting delivery",
  "Ek click mein apni report kholein.": "Open your report with one click.",
  "Follow-up chahiye": "Follow-up needed",
  "IQC check pending": "IQC check pending",
  "Indent result confirm nahi hua. Bina verify kiye dobara submit na karein.": "The indent outcome could not be confirmed. Do not submit again without verifying it.",
  "Indent result confirm nahi hua. Indents list check karein; bina verify kiye dobara submit na karein.": "The indent outcome could not be confirmed. Check the Indents list; do not submit again without verifying it.",
  "Indents list check karein": "Check the Indents list",
  "Jaise: Generator ka oil change chahiye...": "For example: The generator needs an oil change...",
  "Jaise: motor seize ho gaya, seat leak ho rahi hai...": "For example: The motor has seized, the seat is leaking...",
  "Jab tak resolve nahi hota, is Line ka step pause rahega — TAT count nahi hogi.": "This Line's step will remain paused until the issue is resolved — TAT will not be counted.",
  "Kaam Ho Gaya": "Work Completed",
  "Kaam ka type": "Type of work",
  "Kuch employees ke liye computed PF/ESI/TDS unki is period ki gross pay se zyada tha — jo withhold nahi ho paya, wo neeche 'Shortfall' column me dikh raha hai. Ye statutory filing nahi hai — apne accountant/CA se confirm karein ki ye recover kaise hoga.": "For some employees, the calculated PF/ESI/TDS exceeded their gross pay for this period — the amount that could not be withheld is shown in the 'Shortfall' column below. This is not a statutory filing — confirm with your accountant/CA how this amount should be recovered.",
  "Kya kharabi hai": "What is the fault?",
  "Line Breakdowns": "Line Breakdowns",
  "Maintenance": "Maintenance",
  "Maintenance request ban gayi.": "Maintenance request created.",
  "Maintenance requests load ho rahi hain": "Loading maintenance requests",
  "Maintenance requests load nahi ho payi.": "Could not load maintenance requests.",
  "Mark kiya — confirm ka intezaar.": "Marked as completed — awaiting confirmation.",
  "Nayi Maintenance Request": "New Maintenance Request",
  "Nayi Request": "New Request",
  "Open Enquiries": "Open Enquiries",
  "Payments Overdue": "Payments Overdue",
  "Pehle Production Line ka step chunein.": "Select a Production Line step first.",
  "Production Line": "Production Line",
  "Production Line / Step": "Production Line / Step",
  "Production Line breakdown ke liye 'Breakdown Report Karein' button use karein.": "Use the 'Report Breakdown' button for a Production Line breakdown.",
  "Quality Issues": "Quality Issues",
  "Quotations Pending": "Quotations Pending",
  "Recent Activity": "Recent Activity",
  "Report ho raha hai...": "Reporting...",
  "Reopen hui.": "Reopened.",
  "Reported": "Reported",
  "Saari reports dekhein": "View all reports",
  "Save ho raha hai...": "Saving...",
  "Saved indents confirmed hain; server issue hua. Saved items dobara submit na karein.": "The saved indents are confirmed; a server issue occurred. Do not submit the saved items again.",
  "Session expire ho gaya. Dubara login karein.": "Your session has expired. Log in again.",
  "Shortfall": "Shortfall",
  "Step chunein": "Select a step",
  "Theek Nahi Hua": "Not Fixed"
};

function dictionary(file) {
  const values = new Map();
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  function visit(node) {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && ts.isStringLiteral(node.initializer)) {
      assert.ok(!values.has(node.name.text), `duplicate dictionary key: ${node.name.text}`);
      values.set(node.name.text, node.initializer.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return values;
}

test("all 53 original allowances have exact English translations and are removed", () => {
  assert.equal(Object.keys(expectedTranslations).length, 53);
  const values = dictionary(join(root, "src/lib/i18n/en.ts"));
  for (const [key, value] of Object.entries(expectedTranslations)) assert.equal(values.get(key), value, key);
  const baseline = JSON.parse(readFileSync(join(root, "scripts/i18n-baseline.json"), "utf8"));
  assert.deepEqual(baseline.untranslated, []);
  // Permit only the explicitly authorized obsolete WhatsApp allowance removal.
  // Reconstructing its old position retains the immutable original fingerprint:
  // any added allowance, increased count, or unrelated change still fails.
  const obsolete = {
    file: "src/app/api/admin/settings/whatsapp/route.ts", kind: "property:message",
    text: "Base URL ek https:// address hona chahiye, aur internal network ka pata nahi ho sakta.", count: 1,
  };
  const original = [...baseline.unwrapped];
  if (!original.some(item => item.file === obsolete.file && item.kind === obsolete.kind && item.text === obsolete.text)) {
    const index = original.findIndex(item => item.file > obsolete.file);
    original.splice(index < 0 ? original.length : index, 0, obsolete);
  }
  assert.equal(createHash("sha256").update(JSON.stringify(original)).digest("hex"),
    "5ab86e5cf0032486772c7ed5aa0316d3bfc2edf6a976d59a89e799eba4ce8b00", "unwrapped debt may not grow or change beyond the authorized removal");
});

// Run the real repository checker, resolving its real installed TypeScript parser,
// against isolated fixture trees. No loader, mocks, UI edits, or baseline generation.
const scratch = "C:/Users/hp/AppData/Local/hermes/cache/scratch";
function fixture(source, { entries = {}, untranslated = [], unwrapped = [] } = {}) {
  mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(join(scratch, "qa05-translation-followup-"));
  try {
    mkdirSync(join(dir, "src/lib/i18n"), { recursive: true });
    mkdirSync(join(dir, "scripts"));
    writeFileSync(join(dir, "src/view.tsx"), source);
    writeFileSync(join(dir, "src/lib/i18n/en.ts"), `export const EN = ${JSON.stringify(entries)};`);
    writeFileSync(join(dir, "src/lib/guide.ts"), "export const guide = [];\n");
    writeFileSync(join(dir, "src/lib/guide.en.ts"), "export const guide = [];\n");
    writeFileSync(join(dir, "scripts/i18n-baseline.json"), JSON.stringify({ untranslated, unwrapped }));
    const result = spawnSync(process.execPath, [join(root, "scripts/i18n-check.mjs"), "--json"], {
      cwd: dir, encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" }, timeout: 30000
    });
    assert.ifError(result.error);
    assert.equal(result.stderr, "");
    return { status: result.status, diagnostics: JSON.parse(result.stdout) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

for (const source of ["t('unknown key')", "t(`unknown key`)", 't(\n"unknown key", { count: 1 }\n)', "t('x')"]) {
  test(`new unknown key fails: ${source}`, () => {
    const result = fixture(source);
    assert.equal(result.status, 1);
    assert.equal(result.diagnostics.newUntranslated.length, 1);
  });
}

test("complete dictionary passes and comments do not create keys", () => {
  const result = fixture("// t('unknown')\nt('known')", { entries: { known: "Known" } });
  assert.equal(result.status, 0);
  assert.deepEqual(result.diagnostics.untranslated, []);
});
test("orphan dictionary key fails instead of matching its own dictionary source", () => {
  const result = fixture("t('known')", { entries: { known: "Known", orphan: "Unused" } });
  assert.equal(result.status, 1);
});
test("blank English entry fails", () => {
  const result = fixture("t('blank')", { entries: { blank: " " } });
  assert.equal(result.status, 1);
  assert.deepEqual(result.diagnostics.newUntranslated, ["blank"]);
});
test("fixed key with stale missing allowance fails", () => {
  const result = fixture("t('known')", { entries: { known: "Known" }, untranslated: ["known"] });
  assert.equal(result.status, 1);
  assert.deepEqual(result.diagnostics.staleBaseline, ["known"]);
});
for (const source of ["const ui = <p>New copy</p>;", 'const ui = <input placeholder="New copy"/>;', "toast.error('New copy')", "const ui = <p>{ok ? 'New copy' : null}</p>;"]) {
  test(`new unwrapped copy fails: ${source}`, () => {
    const result = fixture(source);
    assert.equal(result.status, 1);
    assert.equal(result.diagnostics.newUnwrapped.length, 1);
  });
}
const allowance = { file: "src/view.tsx", kind: "jsx-text", text: "Existing copy", count: 1 };
test("unchanged copy allowance passes", () => {
  assert.equal(fixture("const ui = <p>Existing copy</p>;", { unwrapped: [allowance] }).status, 0);
});
test("increased occurrence count fails", () => {
  const result = fixture("const ui = <><p>Existing copy</p><p>Existing copy</p></>;", { unwrapped: [allowance] });
  assert.equal(result.status, 1);
  assert.equal(result.diagnostics.newUnwrapped[0].count, 2);
});
test("resolved copy with stale allowance fails", () => {
  const result = fixture("const ui = <p/>;", { unwrapped: [allowance] });
  assert.equal(result.status, 1);
  assert.deepEqual(result.diagnostics.staleUnwrapped, [allowance]);
});
