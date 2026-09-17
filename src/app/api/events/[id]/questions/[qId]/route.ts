import { NextResponse } from "next/server";
import { requireEventRole } from "@/lib/session";
import { updateQuestion, deleteQuestion, getQuestion } from "@/lib/models/rsvp";

/** Every guest must always answer "Are you attending?" — block attempts to hide or unrequire it. */
async function isProtectedAttendingChange(qId: string, patch: any): Promise<boolean> {
  if (patch.active !== false && patch.required !== false) return false;
  const question = await getQuestion(qId);
  return question?.key === "attending";
}

export async function PATCH(req: Request, { params }: { params: { id: string; qId: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  const body = await req.json();
  if (await isProtectedAttendingChange(params.qId, body)) {
    return NextResponse.json({ error: "Attending can't be hidden or made optional — every guest must answer it." }, { status: 400 });
  }
  await updateQuestion(params.qId, body);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string; qId: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  await deleteQuestion(params.qId);
  return NextResponse.json({ ok: true });
}
