/**
 * J5 — session-local controller for the Recorded Job Cost Sheet board. Mirrors
 * `src/lib/costing/client.ts`'s `CostSheetController` shape (idempotency-key retry,
 * lost-response/advanced-version recovery, readback-verified saves) adapted to
 * `JobCostInput`/`JobCostSheet`/`JobCostCalculation` and the plan-eligibility list this
 * feature additionally needs. No money/engine calculation happens here — every number
 * rendered is a server-returned decimal string.
 */
import { ClientMutationKeys } from "@/lib/client-idempotency";
import { jobCostDataEqual, sameJobCostIdentity, validJobCostSnapshot } from "./readback";
import type { JobCostCalculation, JobCostInput, JobCostSheet } from "./types";
import type { JobCostPlanOption, JobCostSheetSummary } from "./service";

interface PendingIntent { url: string; method: "POST" | "PATCH"; body: string; key: string }

export interface JobCostBoardState {
  input: JobCostInput;
  plans: JobCostPlanOption[];
  history: JobCostSheetSummary[];
  saved: JobCostSheet | null;
  preview: JobCostCalculation | null;
  previewBody: string | null;
  pending: PendingIntent | null;
  busy: boolean;
  reading: boolean;
  error: string | null;
  notice: "saved" | "finalized" | null;
  advanced: { accepted: JobCostSheet; current: JobCostSheet } | null;
}

export class JobCostSheetController {
  private state: JobCostBoardState;
  private listeners = new Set<() => void>();
  private keys = new ClientMutationKeys();
  private reads = new Map<string, AbortController>();
  private active = true;
  private generation = 0;
  private writeLock = false;

  constructor(input: JobCostInput, private fetcher: typeof fetch = fetch) {
    this.state = { input, plans: [], history: [], saved: null, preview: null, previewBody: null, pending: null, advanced: null, busy: false, reading: false, error: null, notice: null };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<JobCostBoardState>) {
    if (!this.active) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  activate() { this.active = true; }
  dispose() { this.active = false; this.generation++; this.abortReads(); }
  private abortReads() { this.reads.forEach((c) => c.abort()); this.reads.clear(); }
  private deny(message: string) {
    this.abortReads();
    this.update({ saved: null, preview: null, previewBody: null, plans: [], history: [], advanced: null, notice: null, error: message });
  }
  edit(input: JobCostInput): boolean {
    if (this.state.pending || this.state.advanced || this.writeLock) return false;
    this.abortReads();
    const switched = input.planId !== this.state.input.planId;
    this.update({ input, preview: null, previewBody: null, reading: false, error: null, notice: null, ...(switched ? { saved: null, history: [] } : {}) });
    return true;
  }
  abandon() {
    if (this.writeLock) return;
    const p = this.state.pending;
    if (p) this.keys.complete(p.url, p.key);
    this.update({ pending: null, error: null, notice: null });
  }
  private async read<T>(channel: string, url: string, options?: RequestInit): Promise<T | undefined> {
    this.reads.get(channel)?.abort();
    const controller = new AbortController();
    this.reads.set(channel, controller);
    try {
      const response = await this.fetcher(url, { ...options, credentials: "same-origin", cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!this.active || controller.signal.aborted) return;
      if (response.status === 401 || response.status === 403) {
        this.deny(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
        return;
      }
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
      return body as T;
    } catch (e) {
      if (this.active && !controller.signal.aborted) this.update({ error: e instanceof Error ? e.message : "Request failed" });
    } finally {
      if (this.reads.get(channel) === controller) this.reads.delete(channel);
    }
  }
  async plansList() {
    const result = await this.read<{ plans: JobCostPlanOption[]; nextCursor: string | null }>("plans", "/api/job-cost-sheets/plans?limit=100");
    if (result) this.update({ plans: result.plans });
  }
  async history() {
    if (!this.state.input.planId) { this.update({ history: [] }); return; }
    const result = await this.read<{ sheets: JobCostSheetSummary[] }>("history", `/api/job-cost-sheets?planId=${encodeURIComponent(this.state.input.planId)}`);
    if (result) this.update({ history: result.sheets });
  }
  async load(id: string) {
    if (this.state.pending || this.state.advanced || this.writeLock) return;
    this.abortReads();
    this.update({ reading: true, error: null });
    const result = await this.read<{ sheet: JobCostSheet }>("detail", `/api/job-cost-sheets/${encodeURIComponent(id)}`);
    if (result) this.update({ saved: result.sheet, input: result.sheet.calculation.input, preview: result.sheet.calculation, previewBody: JSON.stringify(result.sheet.calculation.input), reading: false, notice: null });
    else if (this.active && !this.reads.has("detail")) this.update({ reading: false });
  }
  /** Explicit user action: reauthorize/read current state before replacing inputs. */
  async loadCurrent() {
    const advanced = this.state.advanced;
    if (!advanced || this.writeLock || this.state.reading) return;
    this.update({ reading: true, error: null });
    const result = await this.read<{ sheet: JobCostSheet }>("detail", `/api/job-cost-sheets/${encodeURIComponent(advanced.accepted.id)}`);
    if (result) {
      const current = result.sheet;
      if (!validJobCostSnapshot(current) || !sameJobCostIdentity(current, advanced.accepted) || current.version < advanced.current.version
        || (current.version === advanced.current.version && !jobCostDataEqual(current, advanced.current))
        || (advanced.current.status === "Finalized" && !jobCostDataEqual(current, advanced.current))) {
        this.update({ error: "Saved snapshot readback failed", reading: false });
        return;
      }
      this.update({ advanced: null, saved: current, input: current.calculation.input, preview: current.calculation, previewBody: JSON.stringify(current.calculation.input), reading: false, notice: null });
    } else this.update({ reading: false });
  }
  async preview() {
    if (this.state.pending || this.state.advanced || this.writeLock) return;
    const body = JSON.stringify(this.state.input);
    this.update({ reading: true, error: null, notice: null });
    const result = await this.read<{ calculation: JobCostCalculation }>("preview", "/api/job-cost-sheets/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (result) this.update({ preview: result.calculation, previewBody: body, reading: false });
    else if (this.active && !this.reads.has("preview")) this.update({ reading: false });
  }
  canFinalize() {
    const { saved, input, pending, reading } = this.state;
    return !pending && !this.state.advanced && !reading && !this.writeLock && saved?.status === "Draft"
      && saved.calculation.canFinalize && jobCostDataEqual(input, saved.calculation.input) && jobCostDataEqual(this.state.preview, saved.calculation);
  }
  async save(mode: "create" | "update" | "revision" = "create") {
    const { saved, input } = this.state;
    if (mode === "update" && saved?.status !== "Draft") return;
    if (mode === "revision" && saved?.status !== "Finalized") return;
    const url = mode === "update" ? `/api/job-cost-sheets/${encodeURIComponent(saved!.id)}` : "/api/job-cost-sheets";
    const body = mode === "update" ? { input, expectedVersion: saved!.version } : mode === "revision" ? { input, supersedesId: saved!.id } : { input };
    await this.mutate(url, mode === "update" ? "PATCH" : "POST", body);
  }
  async finalize() {
    if (!this.canFinalize()) return;
    const saved = this.state.saved!;
    await this.mutate(`/api/job-cost-sheets/${encodeURIComponent(saved.id)}/finalize`, "POST", { expectedVersion: saved.version, sourceFingerprint: saved.calculation.sourceFingerprint });
  }
  private async mutate(url: string, method: "POST" | "PATCH", value: unknown) {
    if (this.writeLock || this.state.pending || this.state.advanced || this.state.reading) return;
    const body = JSON.stringify(value);
    const pending: PendingIntent = { url, method, body, key: this.keys.keyFor(url, body) };
    this.update({ pending });
    await this.send(pending);
  }
  async retry() { if (!this.writeLock && this.state.pending) await this.send(this.state.pending); }
  private async send(pending: PendingIntent) {
    const generation = this.generation;
    this.writeLock = true;
    this.abortReads();
    this.update({ busy: true, error: null, notice: null });
    try {
      const response = await this.fetcher(pending.url, { method: pending.method, credentials: "same-origin", headers: { "Content-Type": "application/json", "Idempotency-Key": pending.key }, body: pending.body });
      const body = await response.json();
      if (!this.active || generation !== this.generation) return;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) this.deny(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
        // Definitive rejection permits correction. A server failure may have committed.
        if (response.status >= 400 && response.status < 500) {
          this.keys.complete(pending.url, pending.key);
          this.update({ pending: null });
        }
        throw new Error(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
      }
      const accepted = body.sheet as JobCostSheet;
      if (!validJobCostSnapshot(accepted)) throw new Error("Invalid mutation response");
      const intent = JSON.parse(pending.body);
      const finalize = pending.url.endsWith("/finalize");
      const target = `/api/job-cost-sheets/${encodeURIComponent(accepted.id)}${finalize ? "/finalize" : ""}`;
      const valid = pending.url === "/api/job-cost-sheets"
        ? accepted.version === 1 && accepted.status === "Draft" && accepted.supersedesId === (intent.supersedesId ?? null) && jobCostDataEqual(accepted.calculation.input, intent.input)
        : pending.url === target && accepted.version === intent.expectedVersion + 1 && accepted.status === (finalize ? "Finalized" : "Draft") && (finalize || jobCostDataEqual(accepted.calculation.input, intent.input));
      if (!valid) throw new Error("Invalid mutation response");
      const controller = new AbortController();
      this.reads.set("reconcile", controller);
      const check = await this.fetcher(`/api/job-cost-sheets/${encodeURIComponent(accepted.id)}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
      const result = await check.json();
      if (!this.active || generation !== this.generation || controller.signal.aborted) return;
      if (check.status === 401 || check.status === 403) this.deny(typeof result.error === "string" ? result.error : `HTTP ${check.status}`);
      const confirmed = result.sheet as JobCostSheet | undefined;
      if (!check.ok || !validJobCostSnapshot(confirmed) || !sameJobCostIdentity(confirmed, accepted) || confirmed.version < accepted.version) throw new Error("Saved snapshot readback failed");
      if (confirmed.version === accepted.version) {
        if (!jobCostDataEqual(confirmed, accepted)) throw new Error("Saved snapshot readback failed");
        this.update({ saved: confirmed, input: confirmed.calculation.input, preview: confirmed.calculation, previewBody: JSON.stringify(confirmed.calculation.input), notice: finalize ? "finalized" : "saved" });
      } else {
        // A protected same-identity newer row proves the accepted mutation has advanced.
        // It is NOT readback of the accepted calculation. Preserve the user's inputs and
        // require an explicit current-snapshot load, not a POST.
        if (accepted.status === "Finalized") throw new Error("Saved snapshot readback failed");
        this.update({ advanced: { accepted, current: confirmed }, saved: null, preview: null, previewBody: null, notice: null });
      }
      this.keys.complete(pending.url, pending.key);
      this.update({ pending: null });
    } catch (e) {
      if (generation === this.generation) this.update({ error: e instanceof Error ? e.message : "Request failed" });
    } finally {
      this.writeLock = false;
      this.update({ busy: false });
    }
  }
}
