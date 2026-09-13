import { NextResponse } from "next/server";
import { requireEventRole } from "@/lib/session";
import { getInviteeField, listInviteeFields, updateInviteeField, deleteInviteeField } from "@/lib/models/invitee-fields";

/** Guests need at least one way to be reached — block deactivating both email and phone at once. */
async function wouldRemoveAllContactMethods(eventId: string, fieldId: string, patch: any): Promise<boolean> {
  if (patch.active !== false) return false;
  const field = await getInviteeField(fieldId);
  if (!field || (field.key !== "email" && field.key !== "phone")) return false;
  const fields = await listInviteeFields(eventId);
  const otherKey = field.key === "email" ? "phone" : "email";
  const other = fields.find((f) => f.key === otherKey);
  return !other || !other.active;
}

export async function PATCH(req: Request, { params }: { params: { id: string; fieldId: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });

  const body = await req.json();
  if (await wouldRemoveAllContactMethods(params.id, params.fieldId, body)) {
    return NextResponse.json({ error: "At least one of Email or Phone must stay active so guests can be reached." }, { status: 400 });
  }
  if (body.options !== undefined) {
    const field = await getInviteeField(params.fieldId);
    const effectiveType = body.field_type ?? field?.field_type;
    if (effectiveType === "dropdown" && body.options.length < 2) {
      return NextResponse.json({ error: "Add at least two options for a dropdown field." }, { status: 400 });
    }
  }

  await updateInviteeField(params.fieldId, body);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string; fieldId: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  await deleteInviteeField(params.fieldId);
  return NextResponse.json({ ok: true });
}
