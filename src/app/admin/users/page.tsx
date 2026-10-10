import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth/live-session";
import UserManagement from "./user-management";
import { getT } from "@/lib/i18n/server";

export default async function AdminUsersPage() {
  const session = await getLiveSession();
  if (!session) redirect("/login");
  if (session.role !== "Admin") redirect("/dashboard");
  const t = await getT();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="text-muted-foreground">{t("Naye users banayein aur unke roles manage karein.")}</p>
      </div>
      <UserManagement />
    </div>
  );
}
