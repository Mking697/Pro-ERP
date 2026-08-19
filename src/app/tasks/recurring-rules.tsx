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
import { getFrequencyLabel } from "@/lib/frequency";

interface RecurringRule {
  Recurring_ID: string;
  Task: string;
  Doer_ID: string;
  Frequency: string;
  Assign_Date: string;
  Status: string;
}

interface DirectoryUser {
  userId: string;
  fullName: string;
}

/**
 * Lists recurring rules and lets them be paused.
 *
 * Only Active rules generate occurrences, so pausing is how work is put on hold — until
 * now that meant editing the Status cell in the Google Sheet by hand, which no ordinary
 * admin should have to do and which nothing in the app hinted at.
 */
export default function RecurringRules({ refreshKey = 0 }: { refreshKey?: number }) {
  const [rules, setRules] = useState<RecurringRule[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/recurring-tasks").then((r) => r.json()),
      fetch("/api/users/directory").then((r) => r.json()),
    ])
      .then(
        ([rulesData, dirData]: [
          { rules?: RecurringRule[]; setupRequired?: string },
          { users?: DirectoryUser[] },
        ]) => {
          setRules(rulesData.rules ?? []);
          setSetupRequired(rulesData.setupRequired ?? null);
          setNames(
            Object.fromEntries((dirData.users ?? []).map((u) => [u.userId, u.fullName]))
          );
        }
      )
      .catch(() => toast.error("Recurring rules load nahi ho paye."))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  async function toggle(rule: RecurringRule, active: boolean) {
    const next = active ? "Active" : "Paused";
    setSavingId(rule.Recurring_ID);
    try {
      const res = await fetch(`/api/recurring-tasks/${rule.Recurring_ID}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(data?.error ?? "Status update nahi ho paya.");
        return;
      }

      setRules((prev) =>
        prev.map((r) =>
          r.Recurring_ID === rule.Recurring_ID ? { ...r, Status: next } : r
        )
      );
      toast.success(
        next === "Active"
          ? "Rule chalu — kal se occurrences dobara banengi."
          : "Rule paused — nayi occurrences nahi banengi. Purane tasks waise hi rahenge."
      );
    } catch {
      toast.error("Status update nahi ho paya.");
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Loading...</p>;
  }

  if (setupRequired) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        &quot;Recurring Tasks&quot; sheet abhi connect nahi hui hai.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Task</TableHead>
            <TableHead>Doer</TableHead>
            <TableHead>Frequency</TableHead>
            <TableHead>Assign Date</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Active</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                Koi recurring rule nahi hai. &quot;Assign Recurring Task&quot; se banayein.
              </TableCell>
            </TableRow>
          )}
          {rules.map((rule) => {
            const active = rule.Status === "Active";
            return (
              <TableRow key={rule.Recurring_ID}>
                <TableCell className="font-medium">{rule.Task}</TableCell>
                <TableCell>{names[rule.Doer_ID] ?? rule.Doer_ID}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {getFrequencyLabel(rule.Frequency)}
                </TableCell>
                <TableCell className="whitespace-nowrap">{rule.Assign_Date}</TableCell>
                <TableCell>
                  <Badge variant={active ? "default" : "secondary"}>{rule.Status}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Switch
                    checked={active}
                    disabled={savingId === rule.Recurring_ID}
                    onCheckedChange={(checked) => toggle(rule, checked === true)}
                    aria-label={`${rule.Task} ko ${active ? "pause" : "chalu"} karein`}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

