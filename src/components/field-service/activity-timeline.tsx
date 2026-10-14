"use client";

interface Activity {
  id: string;
  kind: string;
  message: string;
  createdAt: string;
}

/** A small, append-only timeline — same convention every other module's own
 * *-activities table already renders (PDI, Maintenance, Orders, ...). */
export default function ActivityTimeline({ activities }: { activities: Activity[] }) {
  if (activities.length === 0) return null;
  return (
    <div className="space-y-2">
      {activities.map((a) => (
        <div key={a.id} className="flex gap-2 text-sm">
          <span className="mt-1 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
          <div>
            <p>{a.message}</p>
            <p className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString("en-IN")}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
