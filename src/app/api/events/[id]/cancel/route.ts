import { NextResponse } from "next/server";
import { getEventById, updateEvent, logAudit } from "@/lib/models/events";
import { listInvitees } from "@/lib/models/invitees";
import { sendCancellationEmail } from "@/lib/notify";
import { requireEventRole } from "@/lib/session";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  const event = await getEventById(params.id);
  if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const message = body.message || "This event has been cancelled by the organizer.";

  await updateEvent(params.id, { status: "cancelled", cancellation_message: message });
  await logAudit(params.id, access.user.email, "event.cancelled", message);

  const invitees = (await listInvitees(params.id)).filter((i) => i.email);
  for (const inv of invitees) {
    sendCancellationEmail(event, inv.email!, inv.first_name, message).catch(() => {});
  }

  return NextResponse.json({ ok: true, notified: invitees.length });
}
