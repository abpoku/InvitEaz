import { NextResponse } from "next/server";
import { requireAssemblyScope } from "@/lib/session";
import { createGroup, listGroups } from "@/lib/models/invitees";
import { getAssembly } from "@/lib/models/assemblies";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  return NextResponse.json({ groups: await listGroups(params.id, access.assemblyId) });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  if (access.role === "viewer") return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });
  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: "Group name is required." }, { status: 400 });

  // A lead planner's groups always land in their own assembly. A full-scope planner may target
  // a specific assembly (e.g. creating a household while adding an invitee to that assembly).
  let assemblyId = access.assemblyId;
  if (!assemblyId && body.assemblyId) {
    const assembly = await getAssembly(body.assemblyId);
    if (!assembly || assembly.event_id !== params.id) return NextResponse.json({ error: "Assembly not found." }, { status: 404 });
    assemblyId = assembly.id;
  }

  const group = await createGroup(params.id, body.name, assemblyId);
  return NextResponse.json({ group });
}
