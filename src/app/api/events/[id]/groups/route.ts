import { NextResponse } from "next/server";
import { requireEventRole } from "@/lib/session";
import { createGroup, listGroups } from "@/lib/models/invitees";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const access = await requireEventRole(params.id, "viewer");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  return NextResponse.json({ groups: await listGroups(params.id) });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: "Group name is required." }, { status: 400 });
  const group = await createGroup(params.id, body.name);
  return NextResponse.json({ group });
}
