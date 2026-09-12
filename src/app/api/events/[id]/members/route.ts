import { NextResponse } from "next/server";
import { requireEventRole } from "@/lib/session";
import { addCoPlanner, listMembers, getEventById, logAudit } from "@/lib/models/events";
import { getUserById, PLAN_LIMITS } from "@/lib/models/users";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const access = await requireEventRole(params.id, "viewer");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  return NextResponse.json({ members: await listMembers(params.id) });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const access = await requireEventRole(params.id, "owner");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });

  const event = (await getEventById(params.id))!;
  const owner = (await getUserById(event.owner_id))!;
  const limit = PLAN_LIMITS[owner.plan].coPlanners;
  const current = (await listMembers(params.id)).length - 1; // exclude owner
  if (current >= limit) {
    return NextResponse.json({ error: `Your plan allows up to ${limit} co-planners. Upgrade to add more.` }, { status: 402 });
  }

  const body = await req.json();
  if (!body.email || !body.role || !["admin", "viewer"].includes(body.role)) {
    return NextResponse.json({ error: "Provide an email and a role of admin or viewer." }, { status: 400 });
  }
  await addCoPlanner(params.id, body.email, body.role);
  await logAudit(params.id, access.user.email, "planner.added", `${body.email} (${body.role})`);
  return NextResponse.json({ ok: true });
}
