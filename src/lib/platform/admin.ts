/**
 * Who operates the platform itself, as opposed to who administers one organization.
 *
 * Kept in an environment variable rather than in the registry sheet on purpose: the
 * registry is written by the app, and an organization Admin can already reach code paths
 * that write to it. If platform-admin were a row or a column, an org Admin could grant it
 * to themselves and read every other customer's data. An env var can only be changed by
 * whoever controls the deployment.
 */
export function getPlatformAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isPlatformAdmin(email: string | undefined | null): boolean {
  if (!email) return false;
  const allowed = getPlatformAdminEmails();
  // An empty list grants nobody — never "allow all" when unconfigured.
  if (allowed.length === 0) return false;
  return allowed.includes(email.trim().toLowerCase());
}
