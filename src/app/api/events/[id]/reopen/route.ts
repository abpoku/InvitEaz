import { NextResponse } from "next/server";
import { updateEvent, logAudit } from "@/lib/models/events";
import { requireEventRole } from "@/lib/session";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  await updateEvent(params.id, { rsvp_reopened: 1 });
  await logAudit(params.id, access.user.email, "rsvp.reopened");
  return NextResponse.json({ ok: true });
}
