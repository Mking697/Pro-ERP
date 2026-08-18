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
import type { SafeUser } from "./types";

export default function UserManagement() {
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/users")
      .then((res) => res.json())
      .then((data: { users: SafeUser[] }) => setUsers(data.users ?? []))
      .catch(() => toast.error("Users load nahi ho paye."))
      .finally(() => setLoading(false));
  }, []);

  function handleCreated(user: SafeUser) {
    setUsers((prev) => [...prev, user]);
  }

  function handleUpdated(updated: SafeUser) {
    setUsers((prev) => prev.map((u) => (u.User_ID === updated.User_ID ? updated : u)));
  }

  if (loading) {
    return <p className="text-muted-foreground">Loading...</p>;
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
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
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
