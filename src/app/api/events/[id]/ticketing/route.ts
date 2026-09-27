import { NextResponse } from "next/server";
import { requireEventRole } from "@/lib/session";
import { getTicketingConfig, adoptFieldAsTicketing, unlinkField } from "@/lib/models/ticketing";
import { getInviteeField } from "@/lib/models/invitee-fields";
import { updateEvent, logAudit } from "@/lib/models/events";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const access = await requireEventRole(params.id, "viewer");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  return NextResponse.json({ config: await getTicketingConfig(params.id) });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });

  const body = await req.json();

  // fieldId is handled separately from `enabled` — it means "adopt this existing field" (non-null)
  // or "unlink the current field" (null), both of which need tier-syncing logic beyond a plain
  // column write, so they go through the model layer rather than a raw updateEvent patch here.
  if (body.fieldId !== undefined) {
    if (body.fieldId === null) {
      await unlinkField(params.id);
      await logAudit(params.id, access.user.email, "ticketing.unlinked", "");
    } else {
      const field = await getInviteeField(body.fieldId);
      if (!field || field.event_id !== params.id || field.kind !== "custom" || field.field_type !== "dropdown") {
        return NextResponse.json({ error: "That field can't be linked to ticketing — pick an active custom dropdown field." }, { status: 400 });
      }
      await adoptFieldAsTicketing(params.id, field.id);
      await logAudit(params.id, access.user.email, "ticketing.linked", field.label);
    }
  }

  if (body.enabled !== undefined) {
    // Disabling never deletes ticket_tiers/ticket_payments rows — just flips the flag, so
    // re-enabling later restores prior prices and payment history untouched.
    await updateEvent(params.id, { ticketing_enabled: body.enabled ? 1 : 0 });
    await logAudit(params.id, access.user.email, "ticketing.updated", `enabled=${!!body.enabled}`);
  }

  if (body.fieldId === undefined && body.enabled === undefined) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  return NextResponse.json({ config: await getTicketingConfig(params.id) });
}
