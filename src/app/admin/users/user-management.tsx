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
import CreateUserDialog from "./create-user-dialog";
import ManageUserDialog from "./manage-user-dialog";
import { parseModuleAccess, getModuleAccessDefinition } from "@/lib/moduleAccess";
import type { SafeUser } from "./types";
import { TableSkeleton } from "@/components/loading-states";
import { useT } from "@/components/preferences-provider";

export default function UserManagement() {
  const t = useT();
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/users")
      .then((res) => res.json())
      .then((data: { users: SafeUser[] }) => setUsers(data.users ?? []))
      .catch(() => toast.error(t("Users load nahi ho paye.")))
      .finally(() => setLoading(false));
  }, [t]);

  function handleCreated(user: SafeUser) {
    setUsers((prev) => [...prev, user]);
  }

  function handleUpdated(updated: SafeUser) {
    setUsers((prev) => prev.map((u) => (u.User_ID === updated.User_ID ? updated : u)));
  }

  if (loading) {
    return <TableSkeleton columns={5} label={t("Users load ho rahe hain")} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <CreateUserDialog onCreated={handleCreated} />
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Access</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  Koi user nahi mila. &quot;Add User&quot; se pehla user banayein.
                </TableCell>
              </TableRow>
            )}
            {users.map((user) => (
              <TableRow key={user.User_ID}>
                <TableCell className="font-medium">{user.Full_Name}</TableCell>
                <TableCell>{user.Email}</TableCell>
                <TableCell>{user.Role}</TableCell>
                <TableCell>{user.Department || "—"}</TableCell>
                <TableCell>
                  {user.Role === "Admin" ? (
                    <Badge variant="secondary">{t("Full access")}</Badge>
                  ) : (
                    (() => {
                      const granted = parseModuleAccess(user.Module_Access);
                      return granted.length === 0 ? (
                        <span className="text-sm text-muted-foreground">—</span>
                      ) : (
                        <span
                          className="text-sm text-muted-foreground"
                          title={granted
                            .map((k) => getModuleAccessDefinition(k)?.label ?? k)
                            .join(", ")}
                        >
                          {granted.length} module{granted.length > 1 ? "s" : ""}
                        </span>
                      );
                    })()
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={user.Status === "Active" ? "default" : "secondary"}>
                    {user.Status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <ManageUserDialog user={user} onUpdated={handleUpdated} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
