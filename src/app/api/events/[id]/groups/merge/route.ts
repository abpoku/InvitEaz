import { NextResponse } from "next/server";
import { requireAssemblyScope } from "@/lib/session";
import { canManageGroup, getGroupById, mergeGroups } from "@/lib/models/invitees";
import { logAudit } from "@/lib/models/events";

/** Merges duplicate groups: `{ targetGroupId, groupIds }` (groupIds includes the target). The target
 * keeps its name and link; the others' members and payments move into it. Same day-to-day scope as
 * other group actions — a lead/co-planner can merge only groups in their own clone. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  if (access.role === "viewer") return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const ids: string[] = Array.isArray(body.groupIds) ? [...new Set(body.groupIds.filter((x: unknown) => typeof x === "string"))] as string[] : [];
  const targetId = typeof body.targetGroupId === "string" ? body.targetGroupId : "";
  if (ids.length < 2 || !ids.includes(targetId)) return NextResponse.json({ error: "Choose at least two groups, and which one to keep." }, { status: 400 });

  const groups = [];
  for (const id of ids) {
    const g = await getGroupById(id);
    if (!g || g.event_id !== params.id || !(await canManageGroup(id, params.id, access.assemblyId))) {
      return NextResponse.json({ error: "Group not found." }, { status: 404 });
    }
    groups.push(g);
  }
  if (new Set(groups.map((g) => g.assembly_id || "")).size > 1) {
    return NextResponse.json({ error: "Groups in different clones can't be merged." }, { status: 400 });
  }

  const target = groups.find((g) => g.id === targetId)!;
  await mergeGroups(targetId, ids.filter((id) => id !== targetId));
  await logAudit(params.id, access.user.email, "groups.merged", `${groups.filter((g) => g.id !== targetId).map((g) => `${g.name} (${g.id})`).join(", ")} → ${target.name} (${target.id})`);
  return NextResponse.json({ ok: true });
}
