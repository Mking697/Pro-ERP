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

// A duplicate key is silently shadowed by whichever copy comes last, so the earlier
// translation simply never runs. TypeScript catches this too, but only at build time.
const duplicates = keys.filter((k, i) => keys.indexOf(k) !== i);

// Strings passed through t("...") that have no English yet.
const wrapped = new Set(
  [...corpus.matchAll(/\bt\(\s*"((?:[^"\\]|\\.){2,})"\s*\)/g)].map((m) => m[1])
);
const known = new Set(keys);
const untranslated = [...wrapped].filter((s) => !known.has(s));

console.log(`en.ts keys              : ${keys.length}`);
console.log(`keys matching no source : ${unmatched.length}`);
console.log(`duplicate keys          : ${duplicates.length}`);
console.log(`t() calls in source     : ${wrapped.size}`);
console.log(`t() calls with no EN    : ${untranslated.length}`);

// The guidebook is a parallel structure rather than dictionary entries, so the two files
// are compared by id: a section added to one and forgotten in the other would otherwise
// vanish for half the readers with nothing to show for it.
function guideIds(file) {
  const src = readFileSync(file, "utf8");
  const body = src.slice(src.indexOf("["));
  return [...body.matchAll(/^\s+id: "([a-z0-9-]+)",$/gm)].map((m) => m[1]);
}
const hiIds = guideIds("src/lib/guide.ts");
const enIds = guideIds("src/lib/guide.en.ts");
const missingEn = hiIds.filter((id) => !enIds.includes(id));
const extraEn = enIds.filter((id) => !hiIds.includes(id));

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

if (duplicates.length) {
  console.log("\nDuplicate keys (the later copy wins, the earlier never runs):");
  for (const k of new Set(duplicates)) console.log("  " + JSON.stringify(k));
}

process.exit(
  unmatched.length || duplicates.length || missingEn.length || extraEn.length ? 1 : 0
);
