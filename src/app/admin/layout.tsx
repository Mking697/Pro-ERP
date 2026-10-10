import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth/live-session";
import AppShell from "@/components/app-shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getLiveSession();

  if (!session) redirect("/login");
  if (session.role !== "Admin") redirect("/dashboard");

  // Navigation lives in AppShell now, so admin pages sit in the same frame as every
  // other page rather than being an island with its own separate nav.
  return <AppShell session={session}>{children}</AppShell>;
}
