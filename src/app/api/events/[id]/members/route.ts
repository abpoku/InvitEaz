import { NextResponse } from "next/server";
import { requireEventRole, requireAssemblyScope } from "@/lib/session";
import { addCoPlanner, listMembers, getEventById, logAudit, isCloneScopedRole } from "@/lib/models/events";
import { getAssembly } from "@/lib/models/assemblies";
import { getUserById, PLAN_LIMITS } from "@/lib/models/users";
import { sendCoPlannerInviteEmail } from "@/lib/notify";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  const members = await listMembers(params.id);
  // A lead planner or co-planner only ever sees their own clone's roster — never the whole
  // event's admin/viewer list or other clones' staffing.
  const visible = access.assemblyId ? members.filter((m: any) => m.assembly_id === access.assemblyId) : members;
  return NextResponse.json({ members: visible });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  const ownerAccess = await requireEventRole(params.id, "owner");

  let targetRole: any;
  let targetAssemblyId: string | null = null;
  let actorEmail: string;

  if (ownerAccess.ok) {
    if (!body.email || !body.role || !["admin", "viewer", "lead_planner", "co_planner"].includes(body.role)) {
      return NextResponse.json({ error: "Provide an email and a role of admin, viewer, lead planner, or co-planner." }, { status: 400 });
    }
    if (isCloneScopedRole(body.role)) {
      if (!body.assemblyId) return NextResponse.json({ error: "Choose a clone for this planner." }, { status: 400 });
      const assembly = await getAssembly(body.assemblyId);
      if (!assembly || assembly.event_id !== params.id) return NextResponse.json({ error: "Clone not found." }, { status: 404 });
      targetAssemblyId = assembly.id;
    }
    targetRole = body.role;
    actorEmail = ownerAccess.user.email;
  } else {
    // Not the owner — a clone's lead planner may still add co-planners scoped to their own clone.
    const scopeAccess = await requireAssemblyScope(params.id);
    if (!scopeAccess.ok) return NextResponse.json({ error: scopeAccess.message }, { status: scopeAccess.status });
    if (scopeAccess.role !== "lead_planner" || !scopeAccess.assemblyId) {
      return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });
    }
    if (!body.email || body.role !== "co_planner") {
      return NextResponse.json({ error: "Lead planners can only add co-planners." }, { status: 403 });
    }
    targetRole = "co_planner";
    targetAssemblyId = scopeAccess.assemblyId; // ignore any client-supplied assemblyId — always their own clone
    actorEmail = scopeAccess.user.email;
  }

  const event = (await getEventById(params.id))!;
  const owner = (await getUserById(event.owner_id))!;
  const members = await listMembers(params.id);

  const limit = PLAN_LIMITS[owner.plan].coPlanners;
  const current = members.length - 1; // exclude owner
  if (current >= limit) {
    return NextResponse.json({ error: `Your plan allows up to ${limit} co-planners. Upgrade to add more.` }, { status: 402 });
  }

  if (targetRole === "co_planner") {
    const existingCoPlanners = members.filter((m: any) => m.assembly_id === targetAssemblyId && m.role === "co_planner").length;
    if (existingCoPlanners >= 3) {
      return NextResponse.json({ error: "This clone already has the maximum of 3 co-planners." }, { status: 400 });
    }
  }

  const { isNewUser } = await addCoPlanner(params.id, body.email, targetRole, targetAssemblyId);
  await logAudit(params.id, actorEmail, "planner.added", `${body.email} (${targetRole})`);
  const assembly = targetAssemblyId ? await getAssembly(targetAssemblyId) : null;
  await sendCoPlannerInviteEmail(event, body.email, targetRole, isNewUser, assembly?.name).catch(() => {});
  return NextResponse.json({ ok: true });
}
