import { NextResponse } from "next/server";
import { requireEventRole, requireAssemblyScope } from "@/lib/session";
import { removeCoPlanner, getMember, logAudit } from "@/lib/models/events";

export async function DELETE(_req: Request, { params }: { params: { id: string; memberId: string } }) {
  const ownerAccess = await requireEventRole(params.id, "owner");
  let actorEmail: string;

  if (ownerAccess.ok) {
    actorEmail = ownerAccess.user.email;
  } else {
    // Not the owner — a clone's lead planner may still remove a co-planner scoped to their own clone.
    const scopeAccess = await requireAssemblyScope(params.id);
    if (!scopeAccess.ok) return NextResponse.json({ error: scopeAccess.message }, { status: scopeAccess.status });
    if (scopeAccess.role !== "lead_planner" || !scopeAccess.assemblyId) {
      return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });
    }
    const target = await getMember(params.memberId);
    if (!target || target.event_id !== params.id || target.role !== "co_planner" || target.assembly_id !== scopeAccess.assemblyId) {
      return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });
    }
    actorEmail = scopeAccess.user.email;
  }

  await removeCoPlanner(params.memberId);
  await logAudit(params.id, actorEmail, "planner.removed", params.memberId);
  return NextResponse.json({ ok: true });
}
