/**
 * Short, collision-resistant IDs for new sheet rows — no need to read the sheet first
 * to count rows. Deliberately NOT derived from row counts: two admins creating a record
 * at the same moment would both read the same count and mint the same ID, and a sheet
 * has no unique constraint to catch it.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32 — no I/L/O/U

function randomSuffix(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** e.g. "TSK-K3M9QX7A" — prefix keeps sheets readable, suffix keeps them unique. */
export function generateId(prefix: string): string {
  return `${prefix}-${randomSuffix(8)}`;
}

/** Lowercase, URL-safe slug for an organization name. */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "org";
}
