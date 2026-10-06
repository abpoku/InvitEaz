import { NextResponse } from "next/server";
import { requireAssemblyScope } from "@/lib/session";
import { listCommunications, logCommunication } from "@/lib/models/comms";
import { getEventById } from "@/lib/models/events";
import { resolveAudience, phoneTextRecipients, AudienceError } from "@/lib/models/messaging";
import { twilioConfigured } from "@/lib/sms";
import { sendInvitationEmail, sendReminderEmail, sendCustomEmail, sendInvitationSms, sendReminderSms, sendCustomSms } from "@/lib/notify";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  return NextResponse.json({ communications: await listCommunications(params.id, access.assemblyId) });
}

/** One endpoint, four actions (body.action):
 *  - "preview": how many people a send would reach, and how many lack an email/phone — shown as a
 *    confirmation before anything goes out.
 *  - "send" (default): email, or automated SMS when Twilio is configured. Failures are counted
 *    separately, never reported as sent.
 *  - "phone_prepare": the checklist for "Text from my phone" (nothing is sent by InvitEaz).
 *  - "phone_log": records how many of those texts the planner opened on their phone. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  if (access.role === "viewer") return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });

  const event = await getEventById(params.id);
  if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const action: string = body.action || "send";
  const { type, subject, message } = body;

  let resolved;
  try {
    resolved = await resolveAudience(params.id, access.assemblyId, body);
  } catch (err) {
    if (err instanceof AudienceError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
  const { invitees, assemblyId, audience } = resolved;

  if (action === "phone_prepare") {
    return NextResponse.json(await phoneTextRecipients(params.id, invitees, !!body.perHousehold));
  }

  if (action === "phone_log") {
    const opened = Math.max(0, Math.floor(Number(body.opened) || 0));
    if (opened === 0) return NextResponse.json({ ok: true, logged: false });
    await logCommunication({
      eventId: params.id, assemblyId, type: type || "custom", channel: "phone",
      subject: body.perHousehold ? "Text from my phone (households)" : "Text from my phone",
      body: String(message || ""), recipientsFilter: audience, recipientCount: opened, sentBy: access.user.email,
    });
    return NextResponse.json({ ok: true, logged: true });
  }

  const channel: "email" | "sms" = body.channel === "sms" ? "sms" : "email";
  if (channel === "sms" && !twilioConfigured()) {
    return NextResponse.json({ error: "Automated texting isn't set up — use Text from my phone instead." }, { status: 400 });
  }
  const reachable = invitees.filter((i) => (channel === "sms" ? i.phone : i.email));

  if (action === "preview") {
    return NextResponse.json({ count: reachable.length, withoutContact: invitees.length - reachable.length });
  }

  if (!message || (channel === "email" && !subject)) {
    return NextResponse.json({ error: channel === "email" ? "Subject and message are required." : "Message is required." }, { status: 400 });
  }

  let sent = 0;
  let failed = 0;
  try {
    for (const inv of reachable) {
      try {
        if (channel === "sms") {
          if (type === "invitation") await sendInvitationSms(event, inv.phone!, inv.first_name, inv.token);
          else if (type === "reminder" || type === "final_reminder") await sendReminderSms(event, inv.phone!, inv.first_name, inv.token, type === "final_reminder");
          else await sendCustomSms(event, inv.phone!, inv.first_name, inv.token, subject || "Text message", message);
        } else {
          if (type === "invitation") await sendInvitationEmail(event, inv.email!, inv.first_name, inv.token);
          else if (type === "reminder" || type === "final_reminder") await sendReminderEmail(event, inv.email!, inv.first_name, inv.token, type === "final_reminder");
          else await sendCustomEmail(event, inv.email!, inv.first_name, inv.token, subject, message);
        }
        sent += 1;
      } catch (err) {
        failed += 1;
        console.error(`[messages] ${channel} to invitee ${inv.id} failed:`, (err as Error)?.message);
      }
    }
  } finally {
    // Logged even if the request dies partway, so the history never hides a half-finished send.
    await logCommunication({
      eventId: params.id, assemblyId, type: type || "custom", channel,
      subject: subject || (channel === "sms" ? "Text message" : ""), body: message,
      recipientsFilter: audience, recipientCount: sent, failedCount: failed, sentBy: access.user.email,
    }).catch((e) => console.error("[messages] could not log communication:", e));
  }

  return NextResponse.json({ sent, failed });
}
