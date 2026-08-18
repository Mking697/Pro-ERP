import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import { IQC_ROLES } from "@/lib/roles";
import InwardBoard from "./inward-board";

export default async function InwardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) redirect("/login");

  const canVerify = IQC_ROLES.includes(session.role as (typeof IQC_ROLES)[number]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Inward & IQC</h1>
        <p className="text-muted-foreground">
          Material inward entries aur unka quality check status.
        </p>
      </div>
      <InwardBoard canVerify={canVerify} />
    </div>
  );
}
