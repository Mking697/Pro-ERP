// Checks the English dictionary against the strings actually present in the source.
//
// A key that does not exactly match a source string can never be looked up, so it is
// dead weight that silently leaves a screen untranslated. This reports both directions:
// keys that match nothing, and wrapped strings with no English yet.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx") || p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const files = walk("src");
const corpus = files.map((f) => readFileSync(f, "utf8")).join("\n");

const enSource = readFileSync("src/lib/i18n/en.ts", "utf8");
const keys = [...enSource.matchAll(/^  "((?:[^"\\]|\\.)*)":/gm)].map((m) => m[1]);

const unmatched = keys.filter((k) => !corpus.includes(k));

// Strings passed through t("...") that have no English yet.
const wrapped = new Set(
  [...corpus.matchAll(/\bt\(\s*"((?:[^"\\]|\\.){2,})"\s*\)/g)].map((m) => m[1])
);
const known = new Set(keys);
const untranslated = [...wrapped].filter((s) => !known.has(s));

console.log(`en.ts keys              : ${keys.length}`);
console.log(`keys matching no source : ${unmatched.length}`);
console.log(`t() calls in source     : ${wrapped.size}`);
console.log(`t() calls with no EN    : ${untranslated.length}`);

if (unmatched.length) {
  console.log("\nKeys that match nothing in src/ (they will never be used):");
  for (const k of unmatched) console.log("  " + JSON.stringify(k));
}
if (untranslated.length) {
  console.log("\nWrapped but still Hinglish for English readers:");
  for (const s of untranslated.slice(0, 40)) console.log("  " + JSON.stringify(s));
  if (untranslated.length > 40) console.log(`  ... and ${untranslated.length - 40} more`);
}

process.exit(unmatched.length ? 1 : 0);
