import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const root = resolve(import.meta.dirname, "..");
const ts = createRequire(import.meta.url)("typescript");
export const obsoleteKeys = [
  "Dashboard pe jayein", "Pehle ye kar lein", "Setup poora karein",
  "Tasks load ho rahe hain", "Tasks load nahi ho paye.", "Settings load nahi ho payi.",
  "Upload nahi ho paya — server se file ka link nahi mila.", "Bas ho gaya", "Abhi koi data nahi.",
  "Sab select karein ", "Outcomes (comma se alag)", "Koi nahi (sirf Outcome/Remark)",
  "PDI Pass hote hi order yahan Invoice banane ke liye aata hai — Invoice No., E-way Bill aur documents dekar Issue karein.",
  "Invoices load nahi ho payi.",
];
export const requiredCopy = {
  "Search failed. Please retry.": "Search failed. Please retry.",
  "Previous search page": "Previous search page", "Previous": "Previous", "Page": "Page",
  "Next search page": "Next search page", "Next": "Next",
  "Full score:": "Full score:", "penalty": "penalty", "evaluated": "evaluated",
  "Recent evaluated details only: up to 20 tasks and 20 FMS steps. Use Excel export for the complete breakdown.": "Recent evaluated details only: up to 20 tasks and 20 FMS steps. Use Excel export for the complete breakdown.",
  "Task / Step": "Task / Step", "Result": "Result", "Penalty": "Penalty",
  "Previous page": "Previous page", "— up to 25 users; charts include the full team.": "— up to 25 users; charts include the full team.",
  "Next page": "Next page",
  "Base URL sirf https://chatxflow.online hona chahiye; custom hosts allowed nahi hain.": "Base URL must be https://chatxflow.online; custom hosts are not allowed.",
};

test("QA05 cleanup removes obsolete keys, translates integration copy, and shrinks the obsolete allowance", () => {
  const source = ts.createSourceFile("en.ts", readFileSync(resolve(root, "src/lib/i18n/en.ts"), "utf8"), ts.ScriptTarget.Latest, true);
  const values = new Map();
  function visit(node) {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && ts.isStringLiteral(node.initializer)) {
      assert.ok(!values.has(node.name.text), `duplicate: ${node.name.text}`);
      values.set(node.name.text, node.initializer.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  for (const key of obsoleteKeys) assert.ok(!values.has(key), `obsolete key: ${key}`);
  for (const [key, value] of Object.entries(requiredCopy)) assert.equal(values.get(key), value, key);
  const baseline = JSON.parse(readFileSync(resolve(root, "scripts/i18n-baseline.json"), "utf8"));
  assert.deepEqual(baseline.untranslated, []);
  assert.ok(!baseline.unwrapped.some(item => item.file === "src/app/api/admin/settings/whatsapp/route.ts" && item.kind === "property:message" && item.text === "Base URL ek https:// address hona chahiye, aur internal network ka pata nahi ho sakta."));
});
