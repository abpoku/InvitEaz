import { NextResponse } from "next/server";
import { requireAssemblyScope } from "@/lib/session";
import { updateInvitee, deactivateInvitee, getInviteeById, canManageInvitee } from "@/lib/models/invitees";
import { logAudit } from "@/lib/models/events";
import { getAssembly } from "@/lib/models/assemblies";
import { fullName } from "@/lib/utils";

export async function PATCH(req: Request, { params }: { params: { id: string; inviteeId: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  if (access.role === "viewer") return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });
  if (!(await canManageInvitee(params.inviteeId, params.id, access.assemblyId))) {
    return NextResponse.json({ error: "Invitee not found." }, { status: 404 });
  }

  const body = await req.json();
  const patch: Record<string, any> = {};
  for (const [k, dbKey] of [
    ["firstName", "first_name"], ["email", "email"], ["phone", "phone"],
    ["notes", "notes"], ["groupId", "group_id"],
  ] as const) {
    if (body[k] !== undefined) patch[dbKey] = body[k] || null;
  }
  // last_name is NOT NULL — events using "single full name" mode intentionally store the whole
  // name in first_name and leave this as "" (see createInvitee / fullName()), so an empty string
  // here is a legitimate value, not "clear this field": never coerce it to null like the columns above.
  if (body.lastName !== undefined) patch.last_name = body.lastName;
  if (body.isAdult !== undefined) patch.is_adult = body.isAdult ? 1 : 0;
  if (body.plusOnePolicy !== undefined) patch.plus_one_policy = body.plusOnePolicy;
  if (body.customFields !== undefined) {
    // Guard against a malformed value (e.g. null) reaching Object.keys — treat anything that
    // isn't a plain object the same as "no custom fields" rather than crashing the request.
    const cf = body.customFields && typeof body.customFields === "object" && !Array.isArray(body.customFields) ? body.customFields : null;
    patch.custom_fields = cf && Object.keys(cf).length ? JSON.stringify(cf) : null;
  }
  // Only a full-scope planner can move an invitee between assemblies — a lead planner can't see
  // other assemblies to move someone into, and shouldn't be able to move someone out of theirs.
  if (body.assemblyId !== undefined && !access.assemblyId) {
    if (body.assemblyId) {
      const assembly = await getAssembly(body.assemblyId);
      if (!assembly || assembly.event_id !== params.id) return NextResponse.json({ error: "Clone not found." }, { status: 404 });
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
  if (!(await canManageInvitee(params.inviteeId, params.id, access.assemblyId))) {
    return NextResponse.json({ error: "Invitee not found." }, { status: 404 });
  }
  const invitee = await getInviteeById(params.inviteeId);
  await deactivateInvitee(params.inviteeId);
  await logAudit(params.id, access.user.email, "invitee.removed", invitee ? fullName(invitee.first_name, invitee.last_name) : params.inviteeId);
  return NextResponse.json({ ok: true });
}
