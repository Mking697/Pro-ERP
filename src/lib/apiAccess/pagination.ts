/** Shared `?limit=&cursor=` pagination for the read-only `/api/v1/*` routes — these
 * routes' underlying domain lib functions (listOrders(), listInvoices(), ...) each return
 * one already-loaded array with no DB-level pagination of their own, so pagination here is
 * applied over that in-memory array. `cursor` is simply the next offset as an opaque
 * string (never parsed/trusted beyond Number() + bounds clamping), `limit` defaults to 50
 * (max 200). Returns `nextCursor: null` once the caller has reached the end. */
export interface PageResult<T> {
  data: T[];
  nextCursor: string | null;
  total: number;
}

export function paginate<T>(items: T[], url: URL): PageResult<T> {
  const rawLimit = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 200) : 50;

  const rawCursor = Number(url.searchParams.get("cursor") ?? "0");
  const offset = Number.isFinite(rawCursor) && rawCursor >= 0 ? Math.floor(rawCursor) : 0;

  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  return {
    data: page,
    nextCursor: nextOffset < items.length ? String(nextOffset) : null,
    total: items.length,
  };
}
