import { NextResponse } from "next/server";
import { requireAssemblyScope } from "@/lib/session";
import { getGroupById, canManageGroup, groupMembers, deleteGroup, renameGroup } from "@/lib/models/invitees";
import { listPaymentsForGroup } from "@/lib/models/ticketing";
import { logAudit } from "@/lib/models/events";

async function loadScopedGroup(groupId: string, eventId: string, assemblyId: string | null) {
  const group = await getGroupById(groupId);
  if (!group || group.event_id !== eventId) return null;
  if (!(await canManageGroup(groupId, eventId, assemblyId))) return null;
  return group;
}

export async function PATCH(req: Request, { params }: { params: { id: string; groupId: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  if (access.role === "viewer") return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });

  const group = await loadScopedGroup(params.groupId, params.id, access.assemblyId);
  if (!group) return NextResponse.json({ error: "Group not found." }, { status: 404 });

  const body = await req.json();
  if (!body.name || !body.name.trim()) return NextResponse.json({ error: "Group name is required." }, { status: 400 });

  await renameGroup(params.groupId, body.name.trim());
  await logAudit(params.id, access.user.email, "group.renamed", params.groupId);
  return NextResponse.json({ group: await getGroupById(params.groupId) });
}

export async function DELETE(_req: Request, { params }: { params: { id: string; groupId: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  if (access.role === "viewer") return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });

  const group = await loadScopedGroup(params.groupId, params.id, access.assemblyId);
  if (!group) return NextResponse.json({ error: "Group not found." }, { status: 404 });

  const members = await groupMembers(params.groupId);
  if (members.length > 0) {
    return NextResponse.json({ error: "This group still has members — remove or reassign them first." }, { status: 400 });
  }
  const payments = await listPaymentsForGroup(params.groupId, true);
  if (payments.length > 0) {
    return NextResponse.json({ error: "This group has payment history and can't be deleted." }, { status: 400 });
  }

  await deleteGroup(params.groupId);
  await logAudit(params.id, access.user.email, "group.deleted", params.groupId);
  return NextResponse.json({ ok: true });
}
