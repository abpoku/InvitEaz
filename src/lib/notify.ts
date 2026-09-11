import { sendEmail, appUrl } from "@/lib/email";
import { formatDate, formatTime } from "@/lib/utils";
import type { EventRow } from "@/lib/models/events";

function eventMeta(event: EventRow): string {
  const where =
    event.location_type === "virtual"
      ? "Online"
      : [event.venue_name, event.city, event.state].filter(Boolean).join(", ") || "Location TBD";
  return `${formatDate(event.event_date)} at ${formatTime(event.event_time)} · ${where}`;
}

function wrap(event: EventRow, heading: string, bodyHtml: string, ctaLabel: string, ctaUrl: string) {
  return `
  <div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#1E2233;">
    <p style="font-size:12px;color:#83879A;margin:0 0 4px;">${event.name}</p>
    <h1 style="font-size:22px;margin:0 0 12px;">${heading}</h1>
    <p style="font-size:14px;color:#4A4F63;margin:0 0 18px;">${eventMeta(event)}</p>
    <div style="font-size:15px;line-height:1.6;color:#1E2233;">${bodyHtml}</div>
    <a href="${ctaUrl}" style="display:inline-block;margin-top:22px;background:#9C2B4E;color:#FAF7F0;padding:11px 22px;border-radius:6px;text-decoration:none;font-family:sans-serif;font-size:14px;">${ctaLabel}</a>
    <p style="margin-top:28px;font-size:12px;color:#83879A;font-family:sans-serif;">Sent via InvitEaz — invite with ease.</p>
  </div>`;
}

export async function sendInvitationEmail(event: EventRow, to: string, name: string, token: string) {
  const url = appUrl(`/r/${token}`);
  const html = wrap(
    event,
    `You're invited, ${name}.`,
    `<p>Please let us know if you can make it — it only takes a minute, and you can change your answer any time before the RSVP deadline.</p>`,
    "Respond now",
    url
  );
  return sendEmail({ to, subject: `You're invited: ${event.name}`, html });
}

export async function sendReminderEmail(event: EventRow, to: string, name: string, token: string, isFinal = false) {
  const url = appUrl(`/r/${token}`);
  const html = wrap(
    event,
    isFinal ? "Last chance to RSVP" : `Still hoping to hear from you, ${name}`,
    `<p>We haven't received your response yet. ${isFinal ? "RSVPs close soon" : "Let us know if you can make it"} so we can finalize plans.</p>`,
    "Respond now",
    url
  );
  return sendEmail({ to, subject: isFinal ? `Final reminder: ${event.name}` : `Reminder: RSVP for ${event.name}`, html });
}

export async function sendConfirmationEmail(event: EventRow, to: string, name: string, token: string, attending: boolean) {
  const url = appUrl(`/r/${token}`);
  const html = wrap(
    event,
    attending ? `You're confirmed, ${name}!` : `Thanks for letting us know, ${name}`,
    `<p>${attending ? "We've got your RSVP and can't wait to see you." : "We're sorry you can't make it this time."} You can change your response any time before the RSVP deadline.</p>`,
    "View or edit your RSVP",
    url
  );
  return sendEmail({ to, subject: `RSVP confirmed: ${event.name}`, html });
}

export async function sendEventUpdateEmail(event: EventRow, to: string, name: string, token: string, changeSummary: string) {
  const url = appUrl(`/r/${token}`);
  const html = wrap(
    event,
    "The details of this event have been updated.",
    `<p>Hi ${name}, here's what changed:</p><p style="background:#F3EEE2;padding:10px 14px;border-radius:6px;">${changeSummary}</p>`,
    "View updated details",
    url
  );
  return sendEmail({ to, subject: `Updated: ${event.name}`, html });
}

export async function sendCancellationEmail(event: EventRow, to: string, name: string, message: string) {
  const html = wrap(
    event,
    "This event has been cancelled.",
    `<p>Hi ${name}, ${event.organizer_name || "the organizer"} has cancelled this event.</p><p style="background:#F3EEE2;padding:10px 14px;border-radius:6px;">${message}</p>`,
    "View event",
    appUrl(`/e/${event.slug}`)
  );
  return sendEmail({ to, subject: `Cancelled: ${event.name}`, html });
}

export async function sendCustomEmail(event: EventRow, to: string, name: string, token: string, subject: string, body: string) {
  const url = appUrl(`/r/${token}`);
  const html = wrap(event, subject, `<p>${body.replace(/\n/g, "<br/>")}</p>`, "View your RSVP", url);
  return sendEmail({ to, subject, html });
}
