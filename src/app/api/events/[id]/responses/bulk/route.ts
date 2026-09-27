import { NextResponse } from "next/server";
import { requireAssemblyScope } from "@/lib/session";
import { canManageInvitation } from "@/lib/models/invitees";
import { recordManualResponse } from "@/lib/models/rsvp";
import { logAudit } from "@/lib/models/events";

const VALID_STATUSES = ["attending", "declined", "maybe"];

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  if (access.role === "viewer") return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });

  const body = await req.json();
  const invitationIds: string[] = Array.isArray(body.invitationIds) ? body.invitationIds : [];
  if (invitationIds.length === 0) return NextResponse.json({ error: "Nothing selected." }, { status: 400 });
  if (!VALID_STATUSES.includes(body.status)) return NextResponse.json({ error: "Invalid status." }, { status: 400 });

  let updated = 0, skipped = 0;
  for (const invitationId of invitationIds) {
    // Out-of-scope selections (a lead/co-planner's request touching an invitation outside their
    // assembly) are dropped from the write, not failed outright — reported back via `skipped`,
    // same transparency principle used by the invitees bulk route.
    if (!(await canManageInvitation(invitationId, params.id, access.assemblyId))) { skipped += 1; continue; }
    await recordManualResponse({
      invitationId,
      eventId: params.id,
      status: body.status,
      numAttending: body.numAttending,
      recordedBy: access.user.email,
    });
    updated += 1;
  }

  await logAudit(params.id, access.user.email, "responses.bulk_set", `${body.status} set on ${updated} invitations`);
  return NextResponse.json({ updated, skipped });
}
