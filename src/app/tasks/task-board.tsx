"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDueDisplay } from "@/lib/formatDate";
import { priorityVariant } from "@/lib/priority";
import AttachmentLink from "@/components/attachment-link";
import CreateTaskDialog from "./create-task-dialog";
import CreateRecurringDialog from "./create-recurring-dialog";
import RecurringRules from "./recurring-rules";
import CompleteTaskDialog from "./complete-task-dialog";
import type { TaskRecord, UserOption } from "./types";
import { CardListSkeleton } from "@/components/loading-states";
import { useT } from "@/components/preferences-provider";

function completionText(task: TaskRecord): string {
  const date = formatDueDisplay(task.Due_Date);
  return task.Task_Type === "Recurring" ? `${date} (${task.Recurrence_Frequency})` : date;
}

function statusBadge(task: TaskRecord) {
  if (task.Status === "Pending" && task.Due_Date && new Date() > new Date(task.Due_Date)) {
    return { label: "Overdue", variant: "destructive" as const };
  }
  if (task.Status === "Done on Time") return { label: task.Status, variant: "default" as const };
  if (task.Status === "Delay Done") return { label: task.Status, variant: "outline" as const };
  return { label: task.Status, variant: "secondary" as const };
}

export default function TaskBoard({ currentUserId }: { currentUserId: string }) {
  const t = useT();
  const [myTasks, setMyTasks] = useState<TaskRecord[]>([]);
  const [delegatedTasks, setDelegatedTasks] = useState<TaskRecord[]>([]);
  const [canDelegate, setCanDelegate] = useState(false);
  const [canAssignRecurring, setCanAssignRecurring] = useState(false);
  // Bumped after a rule is created so the rules tab refetches.
  const [rulesVersion, setRulesVersion] = useState(0);
  const [userMap, setUserMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/tasks").then((res) => res.json()),
      fetch("/api/users/directory").then((res) => res.json()),
    ])
      .then(([tasksData, usersData]: [
        {
          myTasks: TaskRecord[];
          delegatedTasks: TaskRecord[];
          canDelegate: boolean;
          canAssignRecurring: boolean;
        },
        { users: UserOption[] },
      ]) => {
        setMyTasks(tasksData.myTasks ?? []);
        setDelegatedTasks(tasksData.delegatedTasks ?? []);
        setCanDelegate(tasksData.canDelegate ?? false);
        setCanAssignRecurring(tasksData.canAssignRecurring ?? false);

        const map: Record<string, string> = {};
        for (const u of usersData.users ?? []) map[u.userId] = u.fullName;
        setUserMap(map);
      })
      .catch(() => toast.error(t("Tasks load nahi ho paye.")))
      .finally(() => setLoading(false));
  }, [t]);

  function handleCreated(task: TaskRecord) {
    setDelegatedTasks((prev) => [...prev, task]);
    if (task.Assigned_To === currentUserId) {
      setMyTasks((prev) => [...prev, task]);
    }
  }

  function handleCompleted(updated: TaskRecord) {
    setMyTasks((prev) => prev.map((t) => (t.Task_ID === updated.Task_ID ? updated : t)));
    setDelegatedTasks((prev) => prev.map((t) => (t.Task_ID === updated.Task_ID ? updated : t)));
  }

  if (loading) {
    return <CardListSkeleton label={t("Tasks load ho rahe hain")} />;
  }

  const myTasksTable = (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Completion</TableHead>
            <TableHead>Attachment</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {myTasks.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">{t("Koi task assign nahi hua.")}</TableCell>
            </TableRow>
          )}
          {myTasks.map((task) => {
            const badge = statusBadge(task);
            return (
              <TableRow key={task.Task_ID}>
                <TableCell className="font-medium">{task.Title}</TableCell>
                <TableCell>
                  <Badge variant={priorityVariant(task.Priority)}>{task.Priority || "—"}</Badge>
                </TableCell>
                <TableCell>{completionText(task)}</TableCell>
                <TableCell>
                  <AttachmentLink url={task.Attachment_URL} />
                </TableCell>
                <TableCell>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  {task.Status === "Pending" && (
                    <CompleteTaskDialog task={task} onCompleted={handleCompleted} />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );

  // Assigning one-time tasks and creating recurring rules are separate grants now,
  // so someone can hold either without the other.
  if (!canDelegate && !canAssignRecurring) {
    return myTasksTable;
  }

  return (
    <Tabs defaultValue="my-tasks">
      <div className="flex items-center justify-between">
        <TabsList>
          <TabsTrigger value="my-tasks">My Tasks</TabsTrigger>
          <TabsTrigger value="delegated">Delegated by Me</TabsTrigger>
          {canAssignRecurring && (
            <TabsTrigger value="recurring">Recurring Rules</TabsTrigger>
          )}
        </TabsList>
        <div className="flex gap-2">
          {canAssignRecurring && (
            <CreateRecurringDialog onCreated={() => {
                setRulesVersion((v) => v + 1);
                toast.success(t("Ab is rule ke occurrences roz apne-aap generate hongi."));
              }} />
          )}
          {canDelegate && <CreateTaskDialog onCreated={handleCreated} />}
        </div>
      </div>

      <TabsContent value="my-tasks" className="mt-4">
        {myTasksTable}
      </TabsContent>

      <TabsContent value="delegated" className="mt-4">
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Completion</TableHead>
                <TableHead>Attachment</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {delegatedTasks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">{t("Aapne abhi tak koi task assign nahi kiya.")}</TableCell>
                </TableRow>
              )}
              {delegatedTasks.map((task) => {
                const badge = statusBadge(task);
                return (
                  <TableRow key={task.Task_ID}>
                    <TableCell className="font-medium">{task.Title}</TableCell>
                    <TableCell>{userMap[task.Assigned_To] ?? task.Assigned_To}</TableCell>
                    <TableCell>
                      <Badge variant={priorityVariant(task.Priority)}>{task.Priority || "—"}</Badge>
                    </TableCell>
                    <TableCell>{completionText(task)}</TableCell>
                    <TableCell>
                      <AttachmentLink url={task.Attachment_URL} />
                    </TableCell>
                    <TableCell>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </TabsContent>
      {canAssignRecurring && (
        <TabsContent value="recurring" className="mt-4">
          <RecurringRules refreshKey={rulesVersion} />
        </TabsContent>
      )}
    </Tabs>
  );
}
