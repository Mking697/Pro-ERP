import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDueDisplay } from "@/lib/formatDate";
import {
  computeMisBreakdown,
  misOutcomeVariant,
  type MisSummary,
} from "@/lib/mis";
import type { TaskRecord } from "@/lib/tasks";

/**
 * Shows where a MIS score came from, row by row.
 *
 * A bare percentage invites the question "why is it that?" and gives no way to answer it.
 * Each row names the task, what happened to it, and the credit that produced — so the
 * score reads as a consequence of specific work rather than an opaque grade.
 */
export default function ScoreBreakdown({
  tasks,
  summary,
}: {
  tasks: TaskRecord[];
  summary: MisSummary;
}) {
  const rows = computeMisBreakdown(tasks);

  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Abhi tak koi task evaluate nahi hua, isliye score nahi bana.
      </p>
    );
  }

  const totalPoints = rows.reduce((sum, r) => sum + r.points, 0);
  const totalEvaluated = rows.reduce((sum, r) => sum + r.evaluated, 0);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Score ={" "}
        <span className="font-medium tabular-nums text-foreground">
          {totalPoints}
        </span>{" "}
        credit ÷{" "}
        <span className="font-medium tabular-nums text-foreground">
          {totalEvaluated}
        </span>{" "}
        evaluated ={" "}
        <span className="font-medium tabular-nums text-foreground">
          {summary.score === null ? "—" : `${summary.score}%`}
        </span>
      </p>

      {/* Wide table scrolls inside its own box rather than pushing the page sideways. */}
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead>Completion due</TableHead>
              <TableHead>Result</TableHead>
              <TableHead className="text-right">Credit</TableHead>
              <TableHead>Kyun</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow key={`${row.task.Task_ID}-${row.outcome}-${i}`}>
                <TableCell className="font-medium">{row.task.Title}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDueDisplay(row.task.Due_Date)}
                </TableCell>
                <TableCell>
                  <Badge variant={misOutcomeVariant(row.outcome)}>{row.outcome}</Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {row.points} / {row.evaluated}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {row.reason}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
