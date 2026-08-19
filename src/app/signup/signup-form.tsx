"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import PasswordInput from "@/components/password-input";
import LogoPicker from "@/components/logo-picker";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export default function SignupForm({ serviceAccountEmail }: { serviceAccountEmail: string }) {
  const router = useRouter();
  const [orgName, setOrgName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [password, setPassword] = useState("");
  const [systemSheetUrl, setSystemSheetUrl] = useState("");
  const [logo, setLogo] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgName,
          fullName,
          email,
          phoneNumber,
          password,
          systemSheetUrl,
          logo,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? "Account nahi ban paya.");
        return;
      }

      toast.success(`${data.organization.name} ka system taiyaar hai!`);
      router.push("/onboarding");
      router.refresh();
    } catch {
      toast.error("Kuch galat ho gaya. Dobara try karein.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-4">
        <p className="text-sm font-medium">1. Organization</p>
        <div className="space-y-2">
          <Label htmlFor="orgName">Organization Name</Label>
          <Input
            id="orgName"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="Acme Industries Pvt Ltd"
            required
          />
        </div>
        <LogoPicker value={logo} onChange={setLogo} />
      </div>

      <div className="space-y-4">
        <p className="text-sm font-medium">2. Admin account</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="fullName">Your Name</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phoneNumber">WhatsApp Number</Label>
            <Input
              id="phoneNumber"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+91XXXXXXXXXX"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Kam se kam 8 characters"
            minLength={8}
            required
          />
        </div>
      </div>

      <div className="space-y-4">
        <p className="text-sm font-medium">3. Aapka Google Sheet</p>
        <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          <p className="mb-2">
            Ek <strong>blank</strong> Google Sheet banayein, use is address ke saath{" "}
            <strong>Editor</strong> access se share karein:
          </p>
          <code className="block break-all rounded bg-background px-2 py-1.5 text-xs font-medium text-foreground">
            {serviceAccountEmail}
          </code>
          <p className="mt-2">
            Tabs aur header rows hum khud bana denge — aapko kuch type nahi karna.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="systemSheetUrl">System Sheet URL</Label>
          <Input
            id="systemSheetUrl"
            value={systemSheetUrl}
            onChange={(e) => setSystemSheetUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
            required
          />
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "System taiyaar ho raha hai..." : "Create my system"}
      </Button>
    </form>
  );
}
