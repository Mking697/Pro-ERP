// One-off helper to generate a bcrypt hash for the "Password_Hash" column
// in the Users tab, since the sheet must never store a plain-text password.
//
// Usage:  node scripts/hash-password.mjs "MyPlainTextPassword"

import bcrypt from "bcryptjs";

const plain = process.argv[2];

if (!plain) {
  console.error('Usage: node scripts/hash-password.mjs "MyPlainTextPassword"');
  process.exit(1);
}

const hash = bcrypt.hashSync(plain, 10);
console.log(hash);
