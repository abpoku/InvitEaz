import { NextResponse } from "next/server";
import { requireEventRole } from "@/lib/session";
import { renameAssembly, deleteAssembly } from "@/lib/models/assemblies";
import { logAudit } from "@/lib/models/events";

export async function PATCH(req: Request, { params }: { params: { id: string; assemblyId: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  const body = await req.json();
  if (!body.name || typeof body.name !== "string") return NextResponse.json({ error: "Give this assembly a name." }, { status: 400 });
  await renameAssembly(params.assemblyId, body.name);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string; assemblyId: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  await deleteAssembly(params.assemblyId);
  await logAudit(params.id, access.user.email, "assembly.removed", params.assemblyId);
  return NextResponse.json({ ok: true });
}
