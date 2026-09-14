import { NextResponse } from "next/server";
import { requireAssemblyScope } from "@/lib/session";
import { updateInvitee, deactivateInvitee, getInviteeById } from "@/lib/models/invitees";
import { logAudit } from "@/lib/models/events";
import { getAssembly } from "@/lib/models/assemblies";
import { fullName } from "@/lib/utils";

/** A lead planner may only touch invitees already inside their own assembly. */
async function canManage(inviteeId: string, eventId: string, assemblyId: string | null): Promise<boolean> {
  if (!assemblyId) return true; // full-scope planner
  const invitee = await getInviteeById(inviteeId);
  return !!invitee && invitee.event_id === eventId && invitee.assembly_id === assemblyId;
}

export async function PATCH(req: Request, { params }: { params: { id: string; inviteeId: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  if (access.role === "viewer") return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });
  if (!(await canManage(params.inviteeId, params.id, access.assemblyId))) {
    return NextResponse.json({ error: "Invitee not found." }, { status: 404 });
  }

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
  // Only a full-scope planner can move an invitee between assemblies — a lead planner can't see
  // other assemblies to move someone into, and shouldn't be able to move someone out of theirs.
  if (body.assemblyId !== undefined && !access.assemblyId) {
    if (body.assemblyId) {
      const assembly = await getAssembly(body.assemblyId);
      if (!assembly || assembly.event_id !== params.id) return NextResponse.json({ error: "Assembly not found." }, { status: 404 });
      patch.assembly_id = assembly.id;
    } else {
      patch.assembly_id = null;
    }
  }

  await updateInvitee(params.inviteeId, patch);
  return NextResponse.json({ invitee: await getInviteeById(params.inviteeId) });
}

export async function DELETE(_req: Request, { params }: { params: { id: string; inviteeId: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  if (access.role === "viewer") return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });
  if (!(await canManage(params.inviteeId, params.id, access.assemblyId))) {
    return NextResponse.json({ error: "Invitee not found." }, { status: 404 });
  }
  const invitee = await getInviteeById(params.inviteeId);
  await deactivateInvitee(params.inviteeId);
  await logAudit(params.id, access.user.email, "invitee.removed", invitee ? fullName(invitee.first_name, invitee.last_name) : params.inviteeId);
  return NextResponse.json({ ok: true });
}
