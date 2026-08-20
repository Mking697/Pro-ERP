import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import AppShell from "@/components/app-shell";
import { getItemDetail } from "@/lib/inventory/service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TimelineChart, ChartFrame } from "@/components/charts";
import { formatDueDisplay } from "@/lib/formatDate";
import { qty, statusVariant } from "../types";

/**
 * Balance after each movement, oldest first — the same derivation the totals use, kept
 * at every step instead of only at the end. A plain function so the accumulation is not
 * a mutation inside a component body.
 */
function runningBalance(movements: { Timestamp: string; Direction: string; Quantity: string }[]) {
  const points: { label: string; value: number }[] = [];
  let balance = 0;

  for (const m of [...movements].reverse()) {
    const q = Number(m.Quantity) || 0;
    balance += m.Direction === "Out" ? -q : q;
    points.push({
      label: new Date(m.Timestamp).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
      }),
      value: balance,
    });
  }

  // Only the recent tail is legible on a card-width axis.
  return points.slice(-30);
}

function Figure({
  label,
  value,
  unit,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 tabular-nums ${emphasis ? "text-2xl font-semibold" : "text-lg font-medium"}`}
      >
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ sku: string }>;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) redirect("/login");
  if (!session.access.includes("INVENTORY_VIEW")) redirect("/dashboard");

  const { sku } = await params;
  const detail = await getItemDetail(decodeURIComponent(sku));
  if (!detail) notFound();

  const { stock, movements } = detail;
  const item = stock.item;

  const points = runningBalance(movements);

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 mb-1"
              render={<Link href="/inventory">← Inventory</Link>}
            />
            <h1 className="text-2xl font-semibold tracking-tight">{item.Item_Name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {item.SKU}
              {item.Size_Unit && ` · ${item.Size_Unit}`} · {item.Category}
              {item.Location && ` · ${item.Location}`}
            </p>
          </div>
          <Badge variant={statusVariant(stock.status)} className="mt-1">
            {stock.status}
          </Badge>
        </div>

        {stock.missingFields.length > 0 && (
          <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
            Is item ka reorder point nahi ban raha kyunki ye baaki hain:{" "}
            <strong className="text-foreground">{stock.missingFields.join(", ")}</strong>.
            Tab tak system iske liye order suggest nahi karega.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Figure
            label="Free"
            value={qty(stock.free)}
            unit={item.UOM}
            hint="Naya kaam plan karne ke liye itna hi available hai"
            emphasis
          />
          <Figure label="On Hand" value={qty(stock.onHand)} unit={item.UOM} hint="Godown me kul" />
          <Figure
            label="Committed"
            value={qty(stock.committed)}
            unit={item.UOM}
            hint="Production plans ne rok rakha hai"
          />
          <Figure
            label="In Transit"
            value={qty(stock.inTransit)}
            unit={item.UOM}
            hint="Indent uth chuka, maal aana baaki"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Figure
            label="ADC"
            value={qty(stock.adc)}
            unit={`${item.UOM}/din`}
            hint={stock.adcIsManual ? "Manually set" : "Pichle 30 din ke Out se"}
          />
          <Figure
            label="Reorder Point"
            value={qty(stock.rop)}
            unit={item.UOM}
            hint="ADC × Lead Time × Safety Factor"
          />
          <Figure label="Max Level" value={item.Max_Level || "—"} unit={item.UOM} />
        </div>

        <ChartFrame
          title="Stock ka safar"
          hint="Har movement ke baad ka balance — wahi hisaab, bas har kadam par."
        >
          <TimelineChart points={points} emptyMessage="Abhi koi movement nahi hui." />
        </ChartFrame>

        <Card>
          <CardHeader>
            <CardTitle>Movement history</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Direction</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Kisko / Remark</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        Abhi koi movement nahi hui.
                      </TableCell>
                    </TableRow>
                  )}
                  {movements.map((m) => (
                    <TableRow key={m.Txn_ID}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDueDisplay(m.Timestamp)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={m.Direction === "Out" ? "outline" : "default"}>
                          {m.Direction}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {m.Direction === "Out" ? "−" : "+"}
                        {qty(Number(m.Quantity))}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {m.Source}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {[m.Issued_To, m.Remark].filter(Boolean).join(" — ") || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
