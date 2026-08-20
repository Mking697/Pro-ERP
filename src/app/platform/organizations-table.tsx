"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDueDisplay } from "@/lib/formatDate";
import { TableSkeleton } from "@/components/loading-states";
import { useConfirm } from "@/components/confirm-dialog";
import { useT } from "@/components/preferences-provider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface OrgRow {
  orgId: string;
  name: string;
  slug: string;
  ownerEmail: string;
  plan: string;
  status: string;
  createdAt: string;
  systemSheetId: string;
  userCount: number | null;
  error: string | null;
}

export default function OrganizationsTable() {
  const t = useT();
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const confirm = useConfirm();
  const [deleting, setDeleting] = useState<OrgRow | null>(null);
  const [typedName, setTypedName] = useState("");
  const [removing, setRemoving] = useState(false);

  async function handleDelete() {
    if (!deleting) return;
    setRemoving(true);
    try {
      const res = await fetch(`/api/platform/organizations/${deleting.orgId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmName: typedName.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Delete nahi ho paya."));
        return;
      }
      toast.success(`${deleting.name} ${t("delete ho gayi.")}`);
      setOrgs((prev) => prev.filter((o) => o.orgId !== deleting.orgId));
      setDeleting(null);
    } catch {
      toast.error(t("Delete nahi ho paya."));
    } finally {
      setRemoving(false);
    }
  }
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/platform/organizations")
      .then((res) => res.json())
      .then((data: { organizations?: OrgRow[] }) => setOrgs(data.organizations ?? []))
      .catch(() => toast.error(t("Organizations load nahi ho paye.")))
      .finally(() => setLoading(false));
  }, [t]);

  /**
   * Turning the switch off logs out every user in that organization on their next
   * request. It is one click on a row of many, so switching *off* asks first —
   * switching back on does not, because restoring service harms nobody.
   */
  function requestToggle(org: OrgRow, active: boolean) {
    if (active) {
      void toggleStatus(org, true);
      return;
    }
    confirm.ask({
      title: `${org.name} ko suspend karein?`,
      description:
        "Is organization ke saare users agli request par bahar ho jaayenge aur uske automated kaam ruk jaayenge. Data, sheets aur users kuch delete nahi hota — switch wapas on karte hi sab pehle jaisa chalne lagta hai.",
      confirmLabel: "Haan, suspend karein",
      onConfirm: () => toggleStatus(org, false),
    });
  }

  async function toggleStatus(org: OrgRow, active: boolean) {
    const next = active ? "Active" : "Suspended";
    setSavingId(org.orgId);
    try {
      const res = await fetch(`/api/platform/organizations/${org.orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(t(data?.error ?? "Status update nahi ho paya."));
        return;
      }

      setOrgs((prev) =>
        prev.map((o) => (o.orgId === org.orgId ? { ...o, status: next } : o))
      );
      toast.success(
        next === "Active"
          ? `${org.name} dobara chalu.`
          : `${org.name} suspend — uske users ab login nahi kar payenge. Data waise ka waisa rahega.`
      );
    } catch {
      toast.error(t("Status update nahi ho paya."));
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return <TableSkeleton columns={4} label={t("Organizations load ho rahi hain")} />;
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Organization</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead className="text-right">Users</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Active</TableHead>
            <TableHead className="text-right">Delete</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orgs.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">{t("Abhi tak koi organization signup nahi hua.")}</TableCell>
            </TableRow>
          )}
          {orgs.map((org) => {
            const active = org.status === "Active";
            return (
              <TableRow key={org.orgId}>
                <TableCell>
                  <span className="block font-medium">{org.name}</span>
                  <span className="block text-xs text-muted-foreground">{org.slug}</span>
                </TableCell>
                <TableCell className="text-sm">{org.ownerEmail}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{org.plan}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {/* A read failure is worth surfacing: it usually means the org revoked
                      the service account's access to its own sheet. */}
                  {org.error ? (
                    <span className="text-destructive" title={org.error}>
                      error
                    </span>
                  ) : (
                    (org.userCount ?? "—")
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                  {formatDueDisplay(org.createdAt)}
                </TableCell>
                <TableCell>
                  <Badge variant={active ? "default" : "destructive"}>{org.status}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Switch
                    checked={active}
                    disabled={savingId === org.orgId}
                    onCheckedChange={(checked) => requestToggle(org, checked === true)}
                    aria-label={`${org.name} ko ${active ? "suspend" : "chalu"} karein`}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${org.name} delete karein`}
                    onClick={() => {
                      setDeleting(org);
                      setTypedName("");
                    }}
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {confirm.dialog}

      {/* Deleting a tenancy asks for the organization's name to be typed back. A registry
          row sits one click from every other row and this cannot be undone from the UI,
          so it asks for something a stray click cannot produce. */}
      <Dialog open={deleting !== null} onOpenChange={(v) => !v && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{deleting?.name} — delete?</DialogTitle>
            <DialogDescription>
              {t(
                "Is organization ki tenancy khatam ho jaayegi: uske users login nahi kar payenge aur unke email dobara istemaal ho sakenge. Unki apni Google Sheets ko haath nahi lagaya jaata — wo data unka hai."
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="confirm-org-name">
              {t("Pakka karne ke liye organization ka naam likhein")}
            </Label>
            <Input
              id="confirm-org-name"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder={deleting?.name ?? ""}
              autoComplete="off"
            />
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleting(null)}>
              {t("Rehne dein")}
            </Button>
            <Button
              variant="destructive"
              disabled={
                deleting === null ||
                removing ||
                typedName.trim().toLowerCase() !== deleting.name.trim().toLowerCase()
              }
              onClick={handleDelete}
            >
              {removing ? t("Delete ho raha hai...") : t("Delete karein")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
