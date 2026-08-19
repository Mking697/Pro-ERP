import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import AppShell from "@/components/app-shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) redirect("/login");
  if (session.role !== "Admin") redirect("/dashboard");

  // Navigation lives in AppShell now, so admin pages sit in the same frame as every
  // other page rather than being an island with its own separate nav.
  return <AppShell session={session}>{children}</AppShell>;
}
