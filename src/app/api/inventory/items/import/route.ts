import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { createItemsBulk, ITEM_CATEGORIES } from "@/lib/inventory/items";
import { parseItemsFile } from "@/lib/inventory/itemsImport";
import { recordMovementsBulk, type BulkMovementInput } from "@/lib/inventory/ledger";
import { getMutationKey, runIdempotentTenantMutation, MutationConflictError } from "@/lib/mutations";
import { getTenantOrgId } from "@/lib/tenant";

// Same ceiling as the generic attachment upload — Vercel's Hobby serverless functions cap
// a request body around 4.5MB. A spreadsheet of item rows is plain text/XML and tiny per
// row, so this is generous for the sizes this form is actually for.
const MAX_FILE_BYTES = 4 * 1024 * 1024;

// createItemsBulk() writes every row in one Postgres insert, but parsing and validating
// thousands of rows first still risks the serverless function's own time limit. 2000 items
// is already far more than one spreadsheet setup pass would ever cover in practice.
const MAX_ROWS = 2000;

const ALLOWED_EXTENSIONS = [".csv", ".xlsx", ".xls"];

function hasAllowedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export async function POST(request: Request) {
  const guard = await requireModule("INVENTORY_SETUP");
  if (!guard.ok) return guard.response;

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Koi file nahi mili." }, { status: 400 });
  }

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `File ${MAX_FILE_BYTES / (1024 * 1024)}MB se chhoti honi chahiye.` },
      { status: 400 }
    );
  }

  if (!hasAllowedExtension(file.name)) {
    return NextResponse.json(
      { error: "Sirf .csv, .xlsx ya .xls file upload karein." },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let parsed;
  try {
    parsed = await parseItemsFile(buffer, file.name, file.type);
  } catch {
    return NextResponse.json(
      { error: "File padhi nahi ja saki — sahi template download karke dobara try karein." },
      { status: 400 }
    );
  }

  if (parsed.error) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  if (parsed.rows.length === 0) {
    return NextResponse.json({ error: "File me koi row nahi mili." }, { status: 400 });
  }
  if (parsed.rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Ek baar me zyada se zyada ${MAX_ROWS} rows import ki ja sakti hain.` },
      { status: 400 }
    );
  }

  // The Finished Goods board sends this so every row it imports becomes an FG item
  // regardless of what the sheet's own Category column says — matching how its New Item
  // dialog restricts the dropdown to FG outright rather than merely validating it. This
  // is what makes "wrong category typed in the sheet, item silently vanished from the
  // page you imported it from" impossible instead of just documented.
  const forcedCategoryRaw = formData?.get("category");
  const forcedCategory =
    typeof forcedCategoryRaw === "string" &&
    ITEM_CATEGORIES.includes(forcedCategoryRaw as (typeof ITEM_CATEGORIES)[number])
      ? forcedCategoryRaw
      : null;
  const rows = forcedCategory
    ? parsed.rows.map((row) => ({ ...row, category: forcedCategory }))
    : parsed.rows;

  // The whole import — every created item row AND every opening-stock movement it
  // implies — is one replay-safe unit: a retried/duplicated request (same key, same
  // validated rows) must neither re-create items nor re-post opening stock a second
  // time. recordMovementsBulk()'s own runInTenantTransaction(orgId, ...) and
  // createItemsBulk()'s db.insert() both resolve against the AsyncLocalStorage-bound
  // transaction this call opens (src/db/transaction-context.ts), so they automatically
  // join it instead of each opening a separate commit — no signature change needed in
  // either module. The full validated row array (after forcedCategory is applied) is
  // the payload, not a per-row key: a retry must match the entire request, not one row.
  const orgId = await getTenantOrgId();
  try {
    const result = await runIdempotentTenantMutation(orgId, {
      operation: "inventory.items.import.v1",
      actorId: guard.session.userId,
      key: getMutationKey(request),
      // JSON.parse(JSON.stringify(...)) drops `undefined` fields (e.g. an omitted SKU)
      // that canonicalJson would otherwise reject as JSON-unsafe.
      payload: JSON.parse(JSON.stringify(rows)),
    }, async () => {
      const created = await createItemsBulk(rows, guard.session.email);

      // A row's Opening Stock is written as one ledger entry per item, in the same
      // batch — looked up by row number (not SKU) because a blank-SKU row's real SKU
      // only exists on the created record, not on what the file itself said.
      const inputByRow = new Map(parsed.rows.map((r) => [r.row, r]));
      const movements: BulkMovementInput[] = [];
      for (const { row, item } of created.created) {
        const openingStock = inputByRow.get(row)?.openingStock;
        if (openingStock && openingStock > 0) {
          movements.push({
            sku: item.SKU,
            direction: "In",
            quantity: openingStock,
            uom: item.UOM,
            source: "Opening",
            location: item.Location,
            remark: "Bulk import",
            userId: guard.session.userId,
          });
        }
      }
      if (movements.length > 0) {
        await recordMovementsBulk(movements);
      }

      return {
        created: created.created.length,
        openingStockRecorded: movements.length,
        errors: created.errors,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && "committed" in err && err.committed === true && "result" in err) {
      return NextResponse.json({ ...(err.result as object), committed: true, warning: err.message });
    }
    if (err instanceof MutationConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
