import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Shown instead of a page's data when the organization has not connected the sheet that
 * page reads from — the normal state for an org that just signed up.
 */
export default function SetupRequired({
  title = "Abhi setup baaki hai",
  what,
  isAdmin,
}: {
  title?: string;
  what: string;
  isAdmin: boolean;
}) {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>
            {what} ka Google Sheet abhi connect nahi hua hai, isliye yahan dikhane ke liye
            kuch nahi hai.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isAdmin ? (
            <>
              <p className="text-sm text-muted-foreground">
                Ek blank Google Sheet banayein, use service account ke saath Editor access
                se share karein, aur uska URL paste kar dein — headers apne aap ban jaayenge.
              </p>
              <div className="flex gap-2">
                <Button render={<Link href="/onboarding">Setup poora karein</Link>} />
                <Button
                  variant="outline"
                  render={<Link href="/admin/settings">Settings</Link>}
                />
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Apne organization ke Admin se kahein ki wo Settings me ye sheet connect kar dein.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
