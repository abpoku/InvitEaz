import { NextResponse } from "next/server";
import { requireEventRole } from "@/lib/session";
import { getTicketingConfig } from "@/lib/models/ticketing";
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
  const patch: Record<string, any> = {};

  if (body.enabled !== undefined) patch.ticketing_enabled = body.enabled ? 1 : 0;

  if (body.fieldId !== undefined) {
    if (body.fieldId === null) {
      patch.ticket_field_id = null;
    } else {
      const field = await getInviteeField(body.fieldId);
      if (!field || field.event_id !== params.id || field.kind !== "custom" || field.field_type !== "dropdown") {
        return NextResponse.json({ error: "That field can't be linked to ticketing — pick an active custom dropdown field." }, { status: 400 });
      }
      patch.ticket_field_id = field.id;
    }
  }

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  // Disabling never deletes ticket_tiers/ticket_payments rows — just flips the flag, so
  // re-enabling later restores prior prices and payment history untouched.
  await updateEvent(params.id, patch);
  await logAudit(params.id, access.user.email, "ticketing.updated", JSON.stringify(patch));

  return NextResponse.json({ config: await getTicketingConfig(params.id) });
}
