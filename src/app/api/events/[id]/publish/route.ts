import { NextResponse } from "next/server";
import { getEventById, updateEvent, logAudit } from "@/lib/models/events";
import { requireEventRole } from "@/lib/session";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  const event = getEventById(params.id);
  if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

  if (!event.name || !event.event_date || !event.event_time || (event.location_type === "physical" && !event.address && !event.venue_name)) {
    return NextResponse.json({ error: "Add an event name, date, time, and location before publishing." }, { status: 400 });
  }

  updateEvent(params.id, { status: "published" });
  logAudit(params.id, access.user.email, "event.published");
  return NextResponse.json({ ok: true });
}
