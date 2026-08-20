"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import PasswordInput from "@/components/password-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROLES } from "@/lib/roles";
import ModuleAccessPicker from "@/components/module-access-picker";
import { parseModuleAccess } from "@/lib/moduleAccess";
import { generateRandomPassword } from "@/lib/generatePassword";
import type { SafeUser } from "./types";
import { useT } from "@/components/preferences-provider";
import { useConfirm } from "@/components/confirm-dialog";

export default function ManageUserDialog({
  user,
  onUpdated,
  onDeleted,
}: {
  user: SafeUser;
  onUpdated: (user: SafeUser) => void;
  onDeleted: (userId: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState(user.Role);
  const [department, setDepartment] = useState(user.Department);
  const [phoneNumber, setPhoneNumber] = useState(user.Phone_Number);
  const [active, setActive] = useState(user.Status === "Active");
  const [moduleAccess, setModuleAccess] = useState<string[]>(
    parseModuleAccess(user.Module_Access)
  );
  const [savingDetails, setSavingDetails] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [resetting, setResetting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const confirm = useConfirm();

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/users/${user.User_ID}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "User delete nahi ho paya."));
        return;
      }
      toast.success(`${user.Full_Name} ${t("delete ho gaya.")}`);
      setOpen(false);
      onDeleted(user.User_ID);
    } catch {
      toast.error(t("User delete nahi ho paya."));
    } finally {
      setDeleting(false);
    }
  }

  async function handleSaveDetails() {
    setSavingDetails(true);
    try {
      const res = await fetch(`/api/admin/users/${user.User_ID}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          department,
          phoneNumber,
          status: active ? "Active" : "Inactive",
          moduleAccess,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(t(data.error ?? "Update nahi ho paya."));
        return;
      }

      toast.success(t("User update ho gaya."));
      onUpdated(data.user);
    } finally {
      setSavingDetails(false);
    }
  }

  async function handleResetPassword() {
    if (newPassword.length < 6) {
      toast.error(t("Password kam se kam 6 characters ka ho."));
      return;
    }
    setResetting(true);
    try {
      const res = await fetch(`/api/admin/users/${user.User_ID}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(t(data.error ?? "Password reset nahi ho paya."));
        return;
      }

      toast.success(t("Password reset ho gaya."));
      setNewPassword("");
    } finally {
      setResetting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm">Manage</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{user.Full_Name}</DialogTitle>
          <DialogDescription>{user.Email} — {user.User_ID}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-role">Role</Label>
            <Select value={role} onValueChange={(value) => value && setRole(value)}>
              <SelectTrigger id="edit-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-department">Department</Label>
              <Input
                id="edit-department"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-phone">Phone (WhatsApp)</Label>
              <Input
                id="edit-phone"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
              />
            </div>
          </div>
          <ModuleAccessPicker
            value={moduleAccess}
            onChange={setModuleAccess}
            isAdmin={role === "Admin"}
          />

          <div className="flex items-center justify-between rounded-lg border p-3">
            <Label htmlFor="edit-active">Active</Label>
            <Switch id="edit-active" checked={active} onCheckedChange={setActive} />
          </div>
          <Button onClick={handleSaveDetails} disabled={savingDetails} className="w-full">
            {savingDetails ? "Saving..." : "Save Changes"}
          </Button>
        </div>

        <Separator />

        <div className="space-y-2">
          <Label htmlFor="new-password">Reset Password</Label>
          <div className="flex gap-2">
            <PasswordInput
              id="new-password"
              className="flex-1"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t("Naya password")}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => setNewPassword(generateRandomPassword())}
            >
              Generate
            </Button>
          </div>
          <Button
            variant="secondary"
            className="w-full"
            onClick={handleResetPassword}
            disabled={resetting}
          >
            {resetting ? "Resetting..." : "Reset Password"}
          </Button>
        </div>

        <Separator />

        {/* Set apart from the rest, and the only destructive control in the dialog —
            so it is never the button somebody hits while aiming for Save. */}
        <div className="space-y-2">
          <Label>{t("User delete karein")}</Label>
          <p className="text-xs text-muted-foreground">
            {t(
              "User hat jaayega aur uska email dobara istemaal ho sakega. Uske purane tasks aur records waise ke waise rahenge."
            )}
          </p>
          <Button
            variant="destructive"
            className="w-full"
            disabled={deleting}
            onClick={() =>
              confirm.ask({
                title: `${user.Full_Name} ${t("ko delete karein?")}`,
                description: t(
                  "Ye user hat jaayega aur uska email dobara istemaal ho sakega. Wo turant login nahi kar payega. Uske purane tasks aur records nahi mitenge — wo record hain ki kya hua tha."
                ),
                confirmLabel: t("Haan, delete karein"),
                onConfirm: handleDelete,
              })
            }
          >
            {deleting ? t("Delete ho raha hai...") : t("Delete User")}
          </Button>
        </div>

        {confirm.dialog}
      </DialogContent>
    </Dialog>
  );
}
