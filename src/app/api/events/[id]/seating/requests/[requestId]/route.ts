import { NextResponse } from "next/server";
import { requireSeatingAccess } from "@/lib/session";
import { logAudit } from "@/lib/models/events";
import { SeatingError, decideRequest, getRequest, withdrawRequest } from "@/lib/models/seating";

/** approve / reject: owner only. withdraw: a planner from the clone that made the request (or the owner). */
export async function POST(req: Request, { params }: { params: { id: string; requestId: string } }) {
  const access = await requireSeatingAccess(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  const request = await getRequest(params.requestId);
  if (!request || request.event_id !== params.id) return NextResponse.json({ error: "That request no longer exists." }, { status: 404 });

  const { action } = await req.json().catch(() => ({}));
  try {
    if (action === "approve" || action === "reject") {
      if (!access.canApprove) return NextResponse.json({ error: "Only the event owner can approve seating changes." }, { status: 403 });
      await decideRequest(params.id, params.requestId, action === "approve", access.user.email);
      await logAudit(params.id, access.user.email, `seating.request_${action}d`, params.requestId);
    } else if (action === "withdraw") {
      const mine = access.assemblyId ? request.assembly_id === access.assemblyId : access.canApprove;
      if (!mine) return NextResponse.json({ error: "You can't withdraw this request." }, { status: 403 });
      await withdrawRequest(params.requestId, access.user.email);
    } else {
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof SeatingError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
  return NextResponse.json({ ok: true });
}
