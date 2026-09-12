import { NextResponse } from "next/server";
import { requireEventRole } from "@/lib/session";
import { reorderQuestions } from "@/lib/models/rsvp";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  const body = await req.json();
  await reorderQuestions(params.id, body.orderedIds || []);
  return NextResponse.json({ ok: true });
}
