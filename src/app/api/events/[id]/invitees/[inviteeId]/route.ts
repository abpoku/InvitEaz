import { NextResponse } from "next/server";
import { requireEventRole } from "@/lib/session";
import { updateInvitee, deactivateInvitee, getInviteeById } from "@/lib/models/invitees";
import { logAudit } from "@/lib/models/events";
import { fullName } from "@/lib/utils";

export async function PATCH(req: Request, { params }: { params: { id: string; inviteeId: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });

  const body = await req.json();
  const patch: Record<string, any> = {};
  for (const [k, dbKey] of [
    ["firstName", "first_name"], ["lastName", "last_name"], ["email", "email"], ["phone", "phone"],
    ["notes", "notes"], ["groupId", "group_id"],
  ] as const) {
    if (body[k] !== undefined) patch[dbKey] = body[k] || null;
  }
  if (body.isAdult !== undefined) patch.is_adult = body.isAdult ? 1 : 0;
  if (body.plusOnePolicy !== undefined) patch.plus_one_policy = body.plusOnePolicy;
  if (body.customFields !== undefined) patch.custom_fields = Object.keys(body.customFields).length ? JSON.stringify(body.customFields) : null;

  await updateInvitee(params.inviteeId, patch);
  return NextResponse.json({ invitee: await getInviteeById(params.inviteeId) });
}

export async function DELETE(_req: Request, { params }: { params: { id: string; inviteeId: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  const invitee = await getInviteeById(params.inviteeId);
  await deactivateInvitee(params.inviteeId);
  await logAudit(params.id, access.user.email, "invitee.removed", invitee ? fullName(invitee.first_name, invitee.last_name) : params.inviteeId);
  return NextResponse.json({ ok: true });
}
