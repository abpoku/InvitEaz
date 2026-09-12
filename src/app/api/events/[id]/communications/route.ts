import { NextResponse } from "next/server";
import { requireEventRole } from "@/lib/session";
import { listCommunications, logCommunication } from "@/lib/models/comms";
import { listInvitees } from "@/lib/models/invitees";
import { getEventById } from "@/lib/models/events";
import { sendInvitationEmail, sendReminderEmail, sendCustomEmail } from "@/lib/notify";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const access = await requireEventRole(params.id, "viewer");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  return NextResponse.json({ communications: await listCommunications(params.id) });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });

  const event = await getEventById(params.id);
  if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

  const body = await req.json();
  const { type, subject, message, audience, groupId, inviteeIds } = body;
  if (!subject || !message) return NextResponse.json({ error: "Subject and message are required." }, { status: 400 });

  let invitees = (await listInvitees(params.id)).filter((i) => i.email);

  if (audience === "attending") invitees = invitees.filter((i) => i.status === "attending");
  else if (audience === "declined") invitees = invitees.filter((i) => i.status === "declined");
  else if (audience === "no_response") invitees = invitees.filter((i) => !["attending", "declined"].includes(i.status));
  else if (audience === "group" && groupId) invitees = invitees.filter((i) => i.group_id === groupId);
  else if (audience === "selected" && Array.isArray(inviteeIds)) invitees = invitees.filter((i) => inviteeIds.includes(i.id));
  else if (audience === "adults") invitees = invitees.filter((i) => i.is_adult);
  else if (audience === "children") invitees = invitees.filter((i) => !i.is_adult);

  let sent = 0;
  for (const inv of invitees) {
    const fn =
      type === "invitation" ? sendInvitationEmail
      : type === "reminder" ? (e: any, to: string, name: string, tok: string) => sendReminderEmail(e, to, name, tok, false)
      : type === "final_reminder" ? (e: any, to: string, name: string, tok: string) => sendReminderEmail(e, to, name, tok, true)
      : null;

    if (fn) {
      await fn(event, inv.email!, inv.first_name, inv.token).catch(() => {});
    } else {
      await sendCustomEmail(event, inv.email!, inv.first_name, inv.token, subject, message).catch(() => {});
    }
    sent += 1;
  }

  await logCommunication({
    eventId: params.id,
    type: type || "custom",
    subject,
    body: message,
    recipientsFilter: audience || "everyone",
    recipientCount: sent,
    sentBy: access.user.email,
  });

  return NextResponse.json({ sent });
}
