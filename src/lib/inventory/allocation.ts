/**
 * The shared-pool allocation, kept free of every server dependency.
 *
 * This is the one calculation in PPC that is worth being able to reason about — and to
 * run — on its own, so it deliberately imports nothing. No Sheets client, no tenant, no
 * Next runtime: give it lines and a pool of free stock and it returns the split.
 */

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export interface AllocationMaterial {
  sku: string;
  itemName: string;
  uom: string;
  qtyPerUnit: number;
  requiredQty: number;
}

export interface AllocationLine {
  /** Identifies the line back to the caller; results come back in date order. */
  key: string;
  productionDate: string;
  /** Selection order, used only to break ties on the same date. */
  order: number;
  materials: AllocationMaterial[];
}

export interface AllocatedMaterial extends AllocationMaterial {
  allocatedQty: number;
  shortageQty: number;
}

export interface AllocationResult {
  key: string;
  materials: AllocatedMaterial[];
  status: "Ready" | "Shortage";
}

/**
 * Splits one shared pool of free stock across production lines, earliest date first.
 *
 * This is the part such a system usually gets wrong. Checking each product against stock
 * on its own lets two products both report "Ready" off the same hundred screws — the
 * arithmetic is right for each one and wrong for the pair. Here the pool is drawn down as
 * it is handed out, so a later line only ever sees what the earlier ones left, while each
 * line still carries its own status for the person reading the screen.
 *
 * Earliest production date wins because that is what gets built first; a product three
 * weeks out can wait for an indent to arrive.
 */
export function allocateAcrossPool(
  lines: AllocationLine[],
  freeBySku: Map<string, number>
): AllocationResult[] {
  const pool = new Map(freeBySku);

  const ordered = [...lines].sort(
    (a, b) => a.productionDate.localeCompare(b.productionDate) || a.order - b.order
  );

  return ordered.map((line) => {
    const materials = line.materials.map((m) => {
      const available = Math.max(pool.get(m.sku) ?? 0, 0);
      const take = round3(Math.min(m.requiredQty, available));
      pool.set(m.sku, round3(available - take));
      return {
        ...m,
        allocatedQty: take,
        shortageQty: round3(m.requiredQty - take),
      };
    });

    return {
      key: line.key,
      materials,
      status: materials.some((m) => m.shortageQty > 0)
        ? ("Shortage" as const)
        : ("Ready" as const),
    };
  });
}
