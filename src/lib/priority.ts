export const PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;

export type Priority = (typeof PRIORITIES)[number];

export function priorityVariant(priority: string): "destructive" | "outline" | "secondary" {
  if (priority === "Urgent") return "destructive";
  if (priority === "High") return "outline";
  return "secondary";
}
