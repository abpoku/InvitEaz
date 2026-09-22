import { NextResponse } from "next/server";
import { requireAssemblyScope } from "@/lib/session";
import { parseFileToRecords } from "@/lib/csv-import";
import { guessColumnMap, validateRecords, findDuplicates, fieldIssueSummary } from "@/lib/invitee-field-matching";
import { listInviteeFields } from "@/lib/models/invitee-fields";
import { getEventById } from "@/lib/models/events";
import { listAssemblies } from "@/lib/models/assemblies";
import { listInviteesLite } from "@/lib/models/invitees";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  if (access.role === "viewer") return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });

  const event = await getEventById(params.id);
  if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

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
  const { headers, records, parseError } = parseFileToRecords(buffer, file.name);
  if (parseError) return NextResponse.json({ error: parseError }, { status: 400 });

  const fields = await listInviteeFields(params.id);
  const columnMap = guessColumnMap(headers, fields, event.invitee_name_format);
  const baseRows = validateRecords(records, columnMap, fields, event.invitee_name_format);

  // Whole-event, deliberately ignoring access.assemblyId — a duplicate sitting in a different
  // assembly than the one being imported into is exactly the mistake this needs to catch.
  const existingInvitees = (await listInviteesLite(params.id)).map((e) => ({
    id: e.id,
    firstName: e.first_name,
    lastName: e.last_name,
    email: e.email,
    phone: e.phone,
  }));
  const dupes = findDuplicates(baseRows, existingInvitees);
  const rows = baseRows.map((r) => ({ ...r, duplicate: dupes.get(r.rowNumber) ?? null }));

  // A full-scope planner can choose which assembly to import into; a lead/co-planner's imports
  // always land in their own assembly, so they aren't offered a choice.
  const assemblies = access.assemblyId ? [] : await listAssemblies(params.id);

  return NextResponse.json({
    headers,
    records,
    fields,
    nameFormat: event.invitee_name_format,
    columnMap,
    assemblies,
    existingInvitees,
    total: rows.length,
    rows,
    fieldIssueSummary: fieldIssueSummary(rows, fields, event.invitee_name_format),
  });
}
