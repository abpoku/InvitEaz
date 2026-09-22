import { NextResponse } from "next/server";
import { requireAssemblyScope } from "@/lib/session";
import { getInviteeById, canManageInvitee, updateInvitee } from "@/lib/models/invitees";
import { listInviteeFields } from "@/lib/models/invitee-fields";
import { logAudit } from "@/lib/models/events";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  if (access.role === "viewer") return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });

  const body = await req.json();
  const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
  if (ids.length === 0) return NextResponse.json({ error: "Nothing selected." }, { status: 400 });

  const fields = await listInviteeFields(params.id);
  const field = fields.find((f) => f.key === body.fieldKey && f.active);
  if (!field) return NextResponse.json({ error: "Unknown field." }, { status: 400 });

  let updated = 0, skipped = 0;
  for (const id of ids) {
    // Out-of-scope selections (a lead/co-planner's request touching an invitee outside their
    // assembly) are dropped from the write, not failed outright — reported back via `skipped`
    // rather than silently ignored.
    if (!(await canManageInvitee(id, params.id, access.assemblyId))) { skipped += 1; continue; }
    if (field.kind === "custom") {
      const invitee = await getInviteeById(id);
      if (!invitee) { skipped += 1; continue; }
      const current = invitee.custom_fields ? JSON.parse(invitee.custom_fields) : {};
      await updateInvitee(id, { custom_fields: JSON.stringify({ ...current, [field.key]: String(body.value ?? "") }) });
    } else {
      const value = field.key === "is_adult" ? (body.value === "adult" ? 1 : 0) : (body.value || null);
      await updateInvitee(id, { [field.key]: value } as any);
    }
    updated += 1;
  }

  await logAudit(params.id, access.user.email, "invitees.bulk_updated", `${field.label} set on ${updated} invitees`);
  return NextResponse.json({ updated, skipped });
}
