import { NextResponse } from "next/server";
import { requireAssemblyScope } from "@/lib/session";
import { canManageInvitation } from "@/lib/models/invitees";
import { recordManualResponse } from "@/lib/models/rsvp";
import { logAudit } from "@/lib/models/events";

const VALID_STATUSES = ["attending", "declined", "maybe"];

export async function PATCH(req: Request, { params }: { params: { id: string; invitationId: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  if (access.role === "viewer") return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });

  const body = await req.json();
  if (!VALID_STATUSES.includes(body.status)) return NextResponse.json({ error: "Invalid status." }, { status: 400 });

  if (!(await canManageInvitation(params.invitationId, params.id, access.assemblyId))) {
    return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });
  }

  const response = await recordManualResponse({
    invitationId: params.invitationId,
    eventId: params.id,
    status: body.status,
    numAttending: body.numAttending,
    recordedBy: access.user.email,
  });

  await logAudit(params.id, access.user.email, "responses.manual_set", `Set to ${body.status} for invitation ${params.invitationId}`);
  return NextResponse.json({ response });
}
