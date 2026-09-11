import { NextResponse } from "next/server";
import { requireEventRole } from "@/lib/session";
import { parseInviteeFile, findDuplicates } from "@/lib/csv-import";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file uploaded." }, { status: 400 });

  if (!/\.(csv|xlsx|xls)$/i.test(file.name)) {
    return NextResponse.json({ error: "Unsupported file format. Upload a .csv or .xlsx file." }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "File is too large (5MB max)." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { rows, parseError } = parseInviteeFile(buffer, file.name);
  if (parseError) return NextResponse.json({ error: parseError }, { status: 400 });

  const dupeRowNumbers = findDuplicates(rows);
  const withDupes = rows.map((r) => ({ ...r, isDuplicate: dupeRowNumbers.has(r.rowNumber) }));

  const valid = withDupes.filter((r) => r.errors.length === 0 && !r.isDuplicate);
  const invalid = withDupes.filter((r) => r.errors.length > 0);
  const duplicates = withDupes.filter((r) => r.isDuplicate && r.errors.length === 0);

  return NextResponse.json({
    total: rows.length,
    validCount: valid.length,
    invalidCount: invalid.length,
    duplicateCount: duplicates.length,
    valid,
    invalid,
    duplicates,
  });
}
