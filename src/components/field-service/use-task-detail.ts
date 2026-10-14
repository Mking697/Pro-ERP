"use client";

import { useEffect, useState } from "react";
import type { FieldCycleHistory } from "./task-history";

export interface FieldActivity { id: string; kind: string; message: string; createdAt: string }

export async function fetchTaskDetail<T>(url: string, field: string, signal: AbortSignal): Promise<{ task: T; activities: FieldActivity[]; history: FieldCycleHistory[] | null }> {
  const res = await fetch(url, { signal, cache: "no-store" });
  const body = await res.json();
  if (res.status === 401) throw new Error("Session expire ho gaya. Dubara login karein.");
  if (!res.ok || !body[field]) throw new Error(body.error || "Task details load nahi ho paye.");
  return { task: body[field], activities: body.activities ?? [], history: Array.isArray(body.history) ? body.history : null };
}

/** Mask the previous identity immediately; abort and ignore every obsolete request. */
export function useTaskDetail<T>(base: string, id: string | null, field: string) {
  const [version, setVersion] = useState(0);
  const key = `${base}/${id}:${version}`;
  const [state, setState] = useState<{ key: string; task: T | null; activities: FieldActivity[]; history: FieldCycleHistory[] | null; error: string; signal: AbortSignal | null }>({ key: "", task: null, activities: [], history: null, error: "", signal: null });
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    fetchTaskDetail<T>(`${base}/${id}`, field, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setState({ key, ...data, error: "", signal: controller.signal }); })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ key, task: null, activities: [], history: null, error: error instanceof Error ? error.message : "Task details load nahi ho paye.", signal: controller.signal });
      });
    return () => controller.abort();
  }, [base, id, field, key]);
  const current = Boolean(id) && state.key === key && state.signal && !state.signal.aborted;
  return {
    task: current ? state.task : null,
    activities: current ? state.activities : [],
    history: current ? state.history : null,
    error: current ? state.error : "",
    loading: Boolean(id) && !current,
    refresh: () => setVersion((value) => value + 1),
  };
}
