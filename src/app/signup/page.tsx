import Link from "next/link";
import { ListChecks, Boxes, ShoppingCart, LineChart } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import SignupForm from "./signup-form";
import { getT } from "@/lib/i18n/server";
import AuthLayout from "@/components/auth-layout";

export default async function SignupPage() {
  const t = await getT();

  return (
    <AuthLayout
      tagline={t(
        "Ek hi jagah par apna poora business chalayein — Tasks se lekar Dispatch tak."
      )}
      features={[
        { icon: ListChecks, label: t("Task aur Flow Management") },
        { icon: Boxes, label: t("Inventory aur Production") },
        { icon: ShoppingCart, label: t("Sales se Dispatch tak") },
        { icon: LineChart, label: t("Live Dashboard aur MIS Score") },
      ]}
    >
      <Card className="w-full max-w-xl shadow-xl">
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
    </AuthLayout>
  );
}
