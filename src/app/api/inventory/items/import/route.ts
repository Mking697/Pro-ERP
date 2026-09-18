import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { createItemsBulk } from "@/lib/inventory/items";
import { parseItemsFile } from "@/lib/inventory/itemsImport";
import { recordMovementsBulk, type BulkMovementInput } from "@/lib/inventory/ledger";

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

  const result = await createItemsBulk(parsed.rows, guard.session.email);

  // A row's Opening Stock is written as one ledger entry per item, in the same batch —
  // looked up by row number (not SKU) because a blank-SKU row's real SKU only exists on
  // the created record, not on what the file itself said.
  const inputByRow = new Map(parsed.rows.map((r) => [r.row, r]));
  const movements: BulkMovementInput[] = [];
  for (const { row, item } of result.created) {
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

  return NextResponse.json({
    created: result.created.length,
    openingStockRecorded: movements.length,
    errors: result.errors,
  });
}
