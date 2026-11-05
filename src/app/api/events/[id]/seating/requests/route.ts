import { NextResponse } from "next/server";
import { requireSeatingAccess } from "@/lib/session";
import { logAudit } from "@/lib/models/events";
import { SeatingError, decideRequest, listPendingRequests } from "@/lib/models/seating";

/** Owner: approve or reject every pending request at once. Each is decided on its own, so one that
 * no longer fits (table full, guest moved) doesn't stop the rest; those come back in `failed`. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const access = await requireSeatingAccess(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  if (!access.canApprove) return NextResponse.json({ error: "Only the event owner can approve seating changes." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  if (body.action !== "approve_all" && body.action !== "reject_all") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const approve = body.action === "approve_all";

  const pending = await listPendingRequests(params.id, null);
  let done = 0;
  const failed: { name: string; error: string }[] = [];
  for (const r of pending) {
    try {
      await decideRequest(params.id, r.id, approve, access.user.email);
      done++;
    } catch (err) {
      if (!(err instanceof SeatingError)) throw err;
      failed.push({ name: r.invitee_name, error: err.message });
    }
  }
  if (done) await logAudit(params.id, access.user.email, approve ? "seating.requests_approved" : "seating.requests_rejected", `${done} request(s)`);
  return NextResponse.json({ done, failed });
}
