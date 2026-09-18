import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import SignupForm from "./signup-form";
import { getT } from "@/lib/i18n/server";

export default async function SignupPage() {
  const t = await getT();

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>{t("Apne organization ka Pro ERP shuru karein")}</CardTitle>
          <CardDescription>
            {t("Ek minute me aapka apna system taiyaar ho jaayega.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <SignupForm />
          <p className="text-center text-sm text-muted-foreground">
            Pehle se account hai?{" "}
            <Link href="/login" className="font-medium text-foreground underline">{t("Login karein")}</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
