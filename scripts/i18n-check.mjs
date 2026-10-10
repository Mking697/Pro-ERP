// Checks the English dictionary against the strings actually present in the source.
//
// A key that does not exactly match a source string can never be looked up, so it is
// dead weight that silently leaves a screen untranslated. This reports both directions:
// keys that match nothing, and wrapped strings with no English yet.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
const ts = createRequire(import.meta.url)("typescript");

function parse(file) {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
}
function visit(node, fn) {
  fn(node);
  ts.forEachChild(node, (child) => visit(child, fn));
}
function literal(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}
const visibleNames = new Set([
  "placeholder", "title", "alt", "aria-label", "aria-description", "label",
  "description", "caption", "message", "emptyMessage", "errorMessage", "helperText", "tooltip",
]);
const copy = new Map();
function record(file, kind, text) {
  text = text.replace(/\s+/g, " ").trim();
  if (!/\p{L}/u.test(text)) return; // No language content in numbers/decorative glyphs.
  file = file.replaceAll("\\", "/");
  const identity = JSON.stringify([file, kind, text]);
  const item = copy.get(identity) ?? { file, kind, text, count: 0 };
  item.count++;
  copy.set(identity, item);
}
function visibleExpression(file, kind, node) {
  if (literal(node)) record(file, kind, node.text);
  else if (ts.isTemplateExpression(node)) {
    record(file, kind, node.head.text);
    for (const span of node.templateSpans) record(file, kind, span.literal.text);
  } else if (ts.isConditionalExpression(node)) {
    visibleExpression(file, kind, node.whenTrue);
    visibleExpression(file, kind, node.whenFalse);
  } else if (ts.isParenthesizedExpression(node)) visibleExpression(file, kind, node.expression);
  else if (ts.isBinaryExpression(node)) {
    if ([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.PlusToken].includes(node.operatorToken.kind)) {
      if (node.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) visibleExpression(file, kind, node.left);
      visibleExpression(file, kind, node.right);
    }
  }
  // Dynamic values/helper returns need human review. Formatter arguments and route
  // IDs are not UI copy; t(...) is intentionally not walked by this literal detector.
}


function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx") || p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const files = walk("src");
// Do not let a dictionary key count its own declaration as a source use.
const corpus = files.filter((f) => f.replaceAll("\\", "/") !== "src/lib/i18n/en.ts")
  .map((f) => readFileSync(f, "utf8")).join("\n");

// Parse dictionary properties too: quote style/escapes/formatting must not alter
// coverage, and an empty English value must not be treated as translated.
const keys = [];
const known = new Set();
visit(parse("src/lib/i18n/en.ts"), (node) => {
  if (ts.isPropertyAssignment(node) && literal(node.name)) {
    keys.push(node.name.text);
    if (literal(node.initializer) && node.initializer.text.trim()) known.add(node.name.text);
  }
});
const unmatched = keys.filter((k) => !corpus.includes(k) && !corpus.includes(JSON.stringify(k).slice(1, -1)));

// A duplicate key is silently shadowed by whichever copy comes last, so the earlier
// translation simply never runs. TypeScript catches this too, but only at build time.
const duplicates = keys.filter((k, i) => keys.indexOf(k) !== i);

// AST extraction includes single quotes, templates, escapes, one-character keys,
// multiline calls and calls with optional arguments, and excludes comments.
const wrapped = new Set();
for (const file of files) {
  if (file.replaceAll("\\", "/").startsWith("src/lib/i18n/")) continue;
  const source = parse(file);
  visit(source, (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t" && node.arguments[0] && literal(node.arguments[0])) {
      wrapped.add(node.arguments[0].text);
    }
    if (ts.isJsxText(node)) record(file, "jsx-text", node.text);
    if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      visibleExpression(file, "jsx-expression", node.expression);
    }
    if (ts.isJsxAttribute(node) && visibleNames.has(node.name.getText(source)) && node.initializer) {
      const value = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer;
      if (value) visibleExpression(file, "attribute:" + node.name.getText(source), value);
    }
    if (ts.isPropertyAssignment(node)) {
      const name = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : "";
      if (visibleNames.has(name)) visibleExpression(file, "property:" + name, node.initializer);
    }
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(source);
      if (/^(?:toast(?:\.[a-zA-Z]+)?|(?:window\.)?(?:alert|confirm)|setError|setMessage)$/.test(name) && node.arguments[0]) {
        visibleExpression(file, "call:" + name, node.arguments[0]);
      }
    }
  });
}

// Empty translations are also untranslated, rather than silently hiding UI copy.
visit(parse("src/lib/i18n/en.ts"), (node) => {
  if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && literal(node.initializer) && !node.initializer.text.trim()) known.delete(node.name.text);
});
const untranslated = [...wrapped].filter((s) => !known.has(s)).sort();

// A t() call with no EN entry bypasses the dictionary entirely: it falls back to the
// Hinglish source (see src/lib/i18n.ts) instead of ever being translated, which is
// effectively unwrapped copy wearing a t() wrapper. These are gated by a checked-in
// ratchet baseline (scripts/i18n-baseline.json) rather than failing outright, because the
// list was non-trivial (53 strings) at the time this gate was made strict: the baseline
// may only shrink — any currently-missing string NOT already in the baseline fails the
// build immediately, and fixing a baseline entry's EN translation means deleting it from
// the baseline file too (letting the list only shrink over time, never silently grow).
// Baselines must shrink when debt is fixed. Counts matter: another occurrence of
// an already-baselined literal must not be silently permitted, even in the same file.
const baseline = JSON.parse(readFileSync(join("scripts", "i18n-baseline.json"), "utf8"));
if (!Array.isArray(baseline.untranslated) || !Array.isArray(baseline.unwrapped)) {
  throw new Error("Baseline requires untranslated and unwrapped arrays");
}
const baselineSet = new Set(baseline.untranslated);
if (baselineSet.size !== baseline.untranslated.length) throw new Error("Duplicate missing-key baseline entry");
const newUntranslated = untranslated.filter((s) => !baselineSet.has(s));
const staleBaseline = baseline.untranslated.filter((s) => !untranslated.includes(s));
const allowances = new Map();
for (const item of baseline.unwrapped) {
  const id = JSON.stringify([item.file, item.kind, item.text]);
  if (allowances.has(id) || !Number.isInteger(item.count) || item.count < 1) throw new Error("Invalid copy baseline entry");
  allowances.set(id, item);
}
const newUnwrapped = [...copy].filter(([id, item]) => item.count > (allowances.get(id)?.count ?? 0)).map(([, item]) => item);
const staleUnwrapped = [...allowances].filter(([id, item]) => (copy.get(id)?.count ?? 0) < item.count).map(([, item]) => item);
function guideIds(file) {
  const src = readFileSync(file, "utf8");
  const body = src.slice(src.indexOf("["));
  return [...body.matchAll(/^\s+id: "([a-z0-9-]+)",$/gm)].map((m) => m[1]);
}
const hiIds = guideIds("src/lib/guide.ts");
const enIds = guideIds("src/lib/guide.en.ts");
const missingEn = hiIds.filter((id) => !enIds.includes(id));
const extraEn = enIds.filter((id) => !hiIds.includes(id));
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ untranslated, unwrapped: [...copy.values()], newUntranslated, newUnwrapped, staleBaseline, staleUnwrapped }, null, 2));
} else {


console.log(`en.ts keys              : ${keys.length}`);
console.log(`keys matching no source : ${unmatched.length}`);
console.log(`duplicate keys          : ${duplicates.length}`);
console.log(`t() calls in source     : ${wrapped.size}`);
console.log(`t() calls with no EN    : ${untranslated.length}`);
console.log(`  of which baselined    : ${untranslated.length - newUntranslated.length}`);
console.log(`  of which NEW          : ${newUntranslated.length}`);

// Guidebook structures must have matching section IDs.


console.log(`guide ids hi / en       : ${hiIds.length} / ${enIds.length}`);
if (missingEn.length) console.log("  missing from guide.en.ts:", missingEn.join(", "));
if (extraEn.length) console.log("  only in guide.en.ts     :", extraEn.join(", "));

if (unmatched.length) {
  console.log("\nKeys that match nothing in src/ (they will never be used):");
  for (const k of unmatched) console.log("  " + JSON.stringify(k));
}
if (untranslated.length) {
  console.log("\nWrapped but still Hinglish for English readers:");
  for (const s of untranslated.slice(0, 40)) console.log("  " + JSON.stringify(s));
  if (untranslated.length > 40) console.log(`  ... and ${untranslated.length - 40} more`);
}

if (newUntranslated.length) {
  console.log(
    "\nNEW t() calls with no EN translation, not in scripts/i18n-baseline.json (fails the gate):"
  );
  for (const s of newUntranslated) console.log("  " + JSON.stringify(s));
  console.log(
    "\nEither add the EN translation to src/lib/i18n/en.ts, or (only for pre-existing debt) add the string to scripts/i18n-baseline.json."
  );
}

if (staleBaseline.length) {
  console.log(
    "\nscripts/i18n-baseline.json lists strings that are no longer untranslated — remove them to keep the ratchet tight:"
  );
  for (const s of staleBaseline) console.log("  " + JSON.stringify(s));
}

if (duplicates.length) {
  console.log("\nDuplicate keys (the later copy wins, the earlier never runs):");
  for (const k of new Set(duplicates)) console.log("  " + JSON.stringify(k));
}

console.log(`unwrapped copy identities: ${copy.size}`);
console.log(`new unwrapped identities/count increases: ${newUnwrapped.length}`);
for (const item of newUnwrapped) console.log("Unwrapped: " + JSON.stringify(item));
for (const item of staleUnwrapped) console.log("Remove/reduce resolved copy baseline entry: " + JSON.stringify(item));
}

process.exit(
  unmatched.length ||
    duplicates.length ||
    missingEn.length ||
    extraEn.length ||
    newUntranslated.length ||
    newUnwrapped.length ||
    staleBaseline.length ||
    staleUnwrapped.length
    ? 1
    : 0
);
