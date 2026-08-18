import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) redirect("/login");
  if (session.role !== "Admin") redirect("/dashboard");

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <nav className="flex items-center gap-4 border-b pb-4">
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          Dashboard
        </Link>
        <Link href="/admin/users" className="text-sm font-medium hover:text-foreground">
          Users
        </Link>
        <Link href="/admin/settings" className="text-sm font-medium hover:text-foreground">
          Settings
        </Link>
      </nav>
      {children}
    </div>
  );
}
