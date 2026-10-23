import { ClientMutationKeys } from "@/lib/client-idempotency";
import { sameCostIdentity, validCostSnapshot } from "./readback";
import type { CostCalculation, CostProduct, CostSheet, CostSheetInput, CostSheetSummary, StandardCostRate, StandardCostRateInput } from "./types";

/** JSONB does not preserve object-key insertion order; array order and values matter. */
export function costDataEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => costDataEqual(value, b[i]));
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && costDataEqual(left[key], right[key]));
}

interface PendingIntent { url: string; method: "POST" | "PATCH"; body: string; key: string; kind: "sheet" | "rate" }
export interface CostBoardState {
  input: CostSheetInput;
  products: CostProduct[];
  history: CostSheetSummary[];
  saved: CostSheet | null;
  preview: CostCalculation | null;
  previewBody: string | null;
  pending: PendingIntent | null;
  busy: boolean;
  reading: boolean;
  error: string | null;
  notice: "saved" | "approved" | "advanced" | null;
  advanced: { accepted: CostSheet; current: CostSheet } | null;
  approvedRate: StandardCostRate | null;
}

/** Session-local controller. Unknown writes retain their exact serialized intent.
 * React owns its lifetime; no money calculations, storage or broad-module APIs. */
export class CostSheetController {
  private state: CostBoardState;
  private listeners = new Set<() => void>();
  private keys = new ClientMutationKeys();
  private reads = new Map<string, AbortController>();
  private active = true;
  private generation = 0;
  private writeLock = false;
  constructor(input: CostSheetInput, private fetcher: typeof fetch = fetch) {
    this.state = { input, products: [], history: [], saved: null, preview: null, previewBody: null, pending: null, advanced: null, busy: false, reading: false, error: null, notice: null, approvedRate: null };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<CostBoardState>) {
    if (!this.active) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }
  activate() { this.active = true; }
  dispose() { this.active = false; this.generation++; this.abortReads(); }
  private abortReads() { this.reads.forEach(c => c.abort()); this.reads.clear(); }
  private deny(message: string) {
    this.abortReads();
    this.update({ saved: null, preview: null, previewBody: null, products: [], history: [], approvedRate: null, advanced: null, notice: null, error: message });
  }
  edit(input: CostSheetInput): boolean {
    if (this.state.pending || this.state.advanced || this.writeLock) return false;
    this.abortReads();
    const switched = input.productSku !== this.state.input.productSku;
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
  async catalog() {
    const result = await this.read<{ products: CostProduct[] }>("catalog", "/api/cost-sheets/catalog");
    if (result) this.update({ products: result.products });
  }
  async history() {
    const result = await this.read<{ sheets: CostSheetSummary[] }>("history", `/api/cost-sheets?productSku=${encodeURIComponent(this.state.input.productSku)}`);
    if (result) this.update({ history: result.sheets });
  }
  async load(id: string) {
    if (this.state.pending || this.state.advanced || this.writeLock) return;
    this.abortReads();
    this.update({ reading: true, error: null });
    const result = await this.read<{ sheet: CostSheet }>("detail", `/api/cost-sheets/${encodeURIComponent(id)}`);
    if (result) this.update({ saved: result.sheet, input: result.sheet.calculation.input, preview: result.sheet.calculation, previewBody: JSON.stringify(result.sheet.calculation.input), reading: false, notice: null });
    else if (this.active && !this.reads.has("detail")) this.update({ reading: false });
  }
  /** Explicit user action: reauthorize/read current state before replacing inputs. */
  async loadCurrent() {
    const advanced = this.state.advanced;
    if (!advanced || this.writeLock || this.state.reading) return;
    this.update({ reading: true, error: null });
    const result = await this.read<{ sheet: CostSheet }>("detail", `/api/cost-sheets/${encodeURIComponent(advanced.accepted.id)}`);
    if (result) {
      const current = result.sheet;
      if (!validCostSnapshot(current) || !sameCostIdentity(current, advanced.accepted) || current.version < advanced.current.version || (current.version === advanced.current.version && !costDataEqual(current, advanced.current)) || (advanced.current.status === "Finalized" && !costDataEqual(current, advanced.current))) {
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
    const result = await this.read<{ calculation: CostCalculation }>("preview", "/api/cost-sheets/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (result) this.update({ preview: result.calculation, previewBody: body, reading: false });
    else if (this.active && !this.reads.has("preview")) this.update({ reading: false });
  }
  canFinalize() {
    const { saved, input, pending, reading } = this.state;
    return !pending && !this.state.advanced && !reading && !this.writeLock && saved?.status === "Draft" && saved.calculation.complete && costDataEqual(input, saved.calculation.input) && costDataEqual(this.state.preview, saved.calculation);
  }
  async save(mode: "create" | "update" | "revision" = "create") {
    const { saved, input } = this.state;
    if (mode === "update" && saved?.status !== "Draft") return;
    if (mode === "revision" && saved?.status !== "Finalized") return;
    const url = mode === "update" ? `/api/cost-sheets/${encodeURIComponent(saved!.id)}` : "/api/cost-sheets";
    const body = mode === "update" ? { input, expectedVersion: saved!.version } : mode === "revision" ? { input, supersedesId: saved!.id } : { input };
    await this.mutate(url, mode === "update" ? "PATCH" : "POST", body, "sheet");
  }
  async finalize() {
    if (!this.canFinalize()) return;
    const saved = this.state.saved!;
    await this.mutate(`/api/cost-sheets/${encodeURIComponent(saved.id)}/finalize`, "POST", { expectedVersion: saved.version }, "sheet");
  }
  async approve(rate: StandardCostRateInput) { await this.mutate("/api/cost-sheets/standard-rates", "POST", rate, "rate"); }
  private async mutate(url: string, method: "POST" | "PATCH", value: unknown, kind: PendingIntent["kind"]) {
    if (this.writeLock || this.state.pending || this.state.advanced || this.state.reading) return;
    const body = JSON.stringify(value);
    const pending: PendingIntent = { url, method, body, kind, key: this.keys.keyFor(url, body) };
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
      if (pending.kind === "sheet") {
        const accepted = body.sheet as CostSheet;
        if (!validCostSnapshot(accepted)) throw new Error("Invalid mutation response");
        const intent = JSON.parse(pending.body);
        const finalize = pending.url.endsWith("/finalize");
        const target = `/api/cost-sheets/${encodeURIComponent(accepted.id)}${finalize ? "/finalize" : ""}`;
        if (pending.url === "/api/cost-sheets" ? accepted.version !== 1 || accepted.status !== "Draft" || accepted.supersedesId !== (intent.supersedesId ?? null) || !costDataEqual(accepted.calculation.input, intent.input) : pending.url !== target || accepted.version !== intent.expectedVersion + 1 || accepted.status !== (finalize ? "Finalized" : "Draft") || (!finalize && !costDataEqual(accepted.calculation.input, intent.input))) throw new Error("Invalid mutation response");
        const controller = new AbortController();
        this.reads.set("reconcile", controller);
        const check = await this.fetcher(`/api/cost-sheets/${encodeURIComponent(accepted.id)}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        const result = await check.json();
        if (!this.active || generation !== this.generation || controller.signal.aborted) return;
        if (check.status === 401 || check.status === 403) this.deny(typeof result.error === "string" ? result.error : `HTTP ${check.status}`);
        const confirmed = result.sheet as CostSheet | undefined;
        if (!check.ok || !validCostSnapshot(confirmed) || !sameCostIdentity(confirmed, accepted) || confirmed.version < accepted.version) throw new Error("Saved snapshot readback failed");
        if (confirmed.version === accepted.version) {
          if (!costDataEqual(confirmed, accepted)) throw new Error("Saved snapshot readback failed");
          this.update({ saved: confirmed, input: confirmed.calculation.input, preview: confirmed.calculation, previewBody: JSON.stringify(confirmed.calculation.input), notice: "saved" });
        } else {
          // A protected same-identity newer row proves the accepted mutation has
          // advanced. It is NOT readback of the accepted calculation. Preserve the
          // user's inputs and require an explicit current-snapshot load, not a POST.
          if (accepted.status === "Finalized") throw new Error("Saved snapshot readback failed");
          this.update({ advanced: { accepted, current: confirmed }, saved: null, preview: null, previewBody: null, notice: "advanced" });
        }
      } else {
        if (!body.rate?.id) throw new Error("Invalid approval response");
        this.update({ approvedRate: body.rate, preview: null, previewBody: null, notice: "approved" });
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
