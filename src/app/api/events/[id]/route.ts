import { NextResponse } from "next/server";
import { getEventById, updateEvent, deleteEvent, logAudit, computeEffectiveStatus } from "@/lib/models/events";
import { listInvitees } from "@/lib/models/invitees";
import { sendEventUpdateEmail } from "@/lib/notify";
import { requireEventRole } from "@/lib/session";
import { formatDate, formatTime, defaultRsvpDeadline } from "@/lib/utils";

const MATERIAL_FIELDS = ["event_date", "event_time", "venue_name", "address", "city", "meeting_url", "rsvp_deadline", "instructions"] as const;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const access = await requireEventRole(params.id, "viewer");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  const event = await getEventById(params.id);
  if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });
  return NextResponse.json({ event: { ...event, effective_status: computeEffectiveStatus(event) }, role: access.role });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  const event = await getEventById(params.id);
  if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

  const body = await req.json();
  const patch: Record<string, any> = {};
  for (const key of [
    "name", "description", "event_date", "event_time", "end_time", "location_type", "venue_name",
    "address", "city", "state", "zip", "country", "meeting_url", "meeting_instructions",
    "organizer_name", "organizer_contact", "website", "dress_code", "instructions",
    "rsvp_deadline", "visibility", "group_rsvp_mode", "default_plus_one_policy", "theme",
  ]) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  if (body.rsvpDeadline !== undefined) {
    patch.rsvp_deadline = body.rsvpDeadline;
    patch.rsvp_deadline_is_custom = 1;
  }
  // If date/time changed and deadline was never customized, recompute the default.
  if ((body.event_date || body.event_time) && !event.rsvp_deadline_is_custom && body.rsvpDeadline === undefined) {
    patch.rsvp_deadline = defaultRsvpDeadline(body.event_date || event.event_date, body.event_time || event.event_time);
  }

  const materialChange = MATERIAL_FIELDS.some((f) => patch[f] !== undefined && patch[f] !== (event as any)[f]);
  const changeSummary = materialChange ? summarizeChange(event, patch) : null;

  await updateEvent(params.id, patch);
  await logAudit(params.id, access.user.email, "event.edited", Object.keys(patch).join(", "));

  if (materialChange && event.status === "published" && changeSummary) {
    const invitees = (await listInvitees(params.id)).filter((i) => i.email);
    const updated = (await getEventById(params.id))!;
    for (const inv of invitees) {
      sendEventUpdateEmail(updated, inv.email!, inv.first_name, inv.token, changeSummary).catch(() => {});
    }
  }

  return NextResponse.json({ event: await getEventById(params.id) });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const access = await requireEventRole(params.id, "owner");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  await deleteEvent(params.id);
  return NextResponse.json({ ok: true });
}

function summarizeChange(before: any, patch: Record<string, any>): string {
  const parts: string[] = [];
  if (patch.event_date || patch.event_time) {
    parts.push(`New date/time: ${formatDate(patch.event_date || before.event_date)} at ${formatTime(patch.event_time || before.event_time)}`);
  }
  if (patch.venue_name || patch.address || patch.city) {
    parts.push(`New location: ${[patch.venue_name || before.venue_name, patch.city || before.city].filter(Boolean).join(", ")}`);
  }
  if (patch.meeting_url) parts.push("The virtual meeting link has changed.");
  if (patch.rsvp_deadline) parts.push(`New RSVP deadline: ${new Date(patch.rsvp_deadline).toLocaleString()}`);
  if (patch.instructions) parts.push("The event instructions have been updated.");
  return parts.join(" ");
}
