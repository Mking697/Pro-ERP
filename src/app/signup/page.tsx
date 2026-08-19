import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getServiceAccountEmail } from "@/lib/platform/provisioning";
import SignupForm from "./signup-form";

export default function SignupPage() {
  let serviceAccountEmail: string;
  try {
    serviceAccountEmail = getServiceAccountEmail();
  } catch {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Setup incomplete</CardTitle>
            <CardDescription>
              Is Pro ERP install par abhi Google service account configure nahi hua hai.
              Administrator ko <code>GOOGLE_SERVICE_ACCOUNT_EMAIL</code> set karna hoga.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>Apne organization ka Pro ERP shuru karein</CardTitle>
          <CardDescription>
            Aapka data aapke apne Google Sheet me rehta hai — hum sirf usse padhte-likhte hain.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <SignupForm serviceAccountEmail={serviceAccountEmail} />
          <p className="text-center text-sm text-muted-foreground">
            Pehle se account hai?{" "}
            <Link href="/login" className="font-medium text-foreground underline">
              Login karein
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
