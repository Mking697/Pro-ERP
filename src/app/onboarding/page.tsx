import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import { getOrganization } from "@/lib/platform/registry";
import { getServiceAccountEmail } from "@/lib/platform/provisioning";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import AppShell from "@/components/app-shell";
import SheetConnectionsForm from "@/app/admin/settings/sheet-connections-form";
import WhatsAppForm from "@/app/admin/settings/whatsapp-form";

export default async function OnboardingPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) redirect("/login");
  if (session.role !== "Admin") redirect("/dashboard");

  const org = await getOrganization(session.orgId);
  const serviceAccountEmail = getServiceAccountEmail();

  return (
    <AppShell session={session}>
      <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {org ? `${org.Org_Name} ka setup` : "Setup"}
        </h1>
        <p className="text-muted-foreground">
          Apni sheets, Drive folder aur ChatXFlow credentials jodein — phir aapka system
          poori tarah chalu ho jaayega.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pehle ye kar lein</CardTitle>
          <CardDescription>
            Har sheet aur Drive folder is address ke saath <strong>Editor</strong> access
            se share hona chahiye, warna hum usme likh nahi paayenge.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <code className="block break-all rounded bg-muted px-3 py-2 text-sm font-medium">
            {serviceAccountEmail}
          </code>
          <p className="mt-3 text-sm text-muted-foreground">
            Har module ke liye ek blank Google Sheet banayein aur uska URL neeche paste
            karein. Header rows apne aap ban jaayenge — kuch type karne ki zaroorat nahi.
          </p>
        </CardContent>
      </Card>

      <SheetConnectionsForm />
      <WhatsAppForm />

      <Card>
        <CardHeader>
          <CardTitle>Bas ho gaya</CardTitle>
          <CardDescription>
            Jitne module aapne jode hain wo abhi se kaam karenge. Baaki baad me{" "}
            <Link href="/admin/settings" className="underline">
              Settings
            </Link>{" "}
            se kabhi bhi jod sakte hain.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button render={<Link href="/dashboard">Dashboard pe jayein</Link>} />
        </CardContent>
      </Card>
      </div>
    </AppShell>
  );
}
