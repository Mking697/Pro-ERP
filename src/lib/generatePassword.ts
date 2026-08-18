const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";

/** Browser-only: generates a random password for the "create user" form's Generate button. */
export function generateRandomPassword(length = 10): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => CHARSET[n % CHARSET.length]).join("");
}
