import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { parseImportFile } from "@/lib/importFile";
import { upsertHolidaysBulk, type BulkHolidayRowInput } from "@/lib/holidays";

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_ROWS = 2000;
const ALLOWED_EXTENSIONS = [".csv", ".xlsx", ".xls"];

function hasAllowedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

type HolidayField = keyof Omit<BulkHolidayRowInput, "row">;

const HEADER_ALIASES: Record<string, HolidayField> = {
  date: "date",
  name: "name",
  holiday: "name",
  holidayname: "name",
};

export async function POST(request: Request) {
  const guard = await requireRole(["Admin"]);
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
    parsed = await parseImportFile<HolidayField, BulkHolidayRowInput>(
      buffer,
      file.name,
      file.type,
      HEADER_ALIASES,
      "date",
      (row, fields) => ({
        row,
        date: fields.date ?? "",
        name: fields.name ?? "",
      })
    );
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

  const result = await upsertHolidaysBulk(parsed.rows);

  return NextResponse.json({
    created: result.created.length,
    errors: result.errors,
    warnings: [],
  });
}
