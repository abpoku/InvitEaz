import { NextResponse } from "next/server";
import { requireEventRole } from "@/lib/session";
import { updateQuestion, deleteQuestion } from "@/lib/models/rsvp";

export async function PATCH(req: Request, { params }: { params: { id: string; qId: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  const body = await req.json();
  await updateQuestion(params.qId, body);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string; qId: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  await deleteQuestion(params.qId);
  return NextResponse.json({ ok: true });
}
