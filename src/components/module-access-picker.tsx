"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { MODULE_ACCESS } from "@/lib/moduleAccess";
import { useT } from "@/components/preferences-provider";

/**
 * The checkboxes an Admin uses to decide which parts of the system a person works in.
 *
 * Admins are shown as locked-on rather than hidden: an Admin holds every grant
 * implicitly, and silently rendering an empty picker would read as "this user has no
 * access" when the opposite is true.
 */
export default function ModuleAccessPicker({
  value,
  onChange,
  isAdmin = false,
  disabled = false,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  isAdmin?: boolean;
  disabled?: boolean;
}) {
  const t = useT();
  function toggle(key: string, checked: boolean) {
    onChange(checked ? [...value, key] : value.filter((k) => k !== key));
  }

  return (
    <fieldset className="space-y-2" disabled={disabled || isAdmin}>
      <legend className="text-sm font-medium">System Access</legend>
      <p className="text-xs text-muted-foreground">
        {isAdmin
          ? t("Admin ke paas har module ka access apne aap hota hai.")
          : t("Jo modules tick karenge, wahi is user ke dashboard par dikhenge.")}
      </p>

      <div className="grid gap-2 pt-1 sm:grid-cols-2">
        {MODULE_ACCESS.map((m) => {
          const checked = isAdmin || value.includes(m.key);
          return (
            <label
              key={m.key}
              className="flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 text-sm transition-colors duration-150 hover:bg-muted/60 has-disabled:cursor-not-allowed has-disabled:opacity-60"
            >
              <Checkbox
                checked={checked}
                disabled={disabled || isAdmin}
                onCheckedChange={(next) => toggle(m.key, next === true)}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block font-medium leading-tight">{t(m.label)}</span>
                <span className="block text-xs leading-tight text-muted-foreground">
                  {t(m.description)}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
