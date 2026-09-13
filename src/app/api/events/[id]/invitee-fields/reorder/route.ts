import { NextResponse } from "next/server";
import { requireEventRole } from "@/lib/session";
import { reorderInviteeFields } from "@/lib/models/invitee-fields";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  const body = await req.json();
  await reorderInviteeFields(params.id, body.orderedIds || []);
  return NextResponse.json({ ok: true });
}
