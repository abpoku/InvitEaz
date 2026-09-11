import { getDb } from "@/lib/db";
import { newId, defaultRsvpDeadline, uniqueSlug, isPastDeadline, eventStartDateTime } from "@/lib/utils";

export type EventStatus = "draft" | "published" | "rsvp_closed" | "completed" | "cancelled";
export type LocationType = "physical" | "virtual" | "hybrid";
export type Visibility = "invite_only" | "public" | "hybrid";
export type GroupRsvpMode = "group" | "individual" | "primary_contact";
export type PlusOnePolicy = "none" | "one" | "multiple";
export type Role = "owner" | "admin" | "viewer";

export interface EventRow {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  description: string | null;
  event_date: string;
  event_time: string;
  end_time: string | null;
  location_type: LocationType;
  venue_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  meeting_url: string | null;
  meeting_instructions: string | null;
  image_url: string | null;
  organizer_name: string | null;
  organizer_contact: string | null;
  website: string | null;
  dress_code: string | null;
  instructions: string | null;
  rsvp_deadline: string | null;
  rsvp_deadline_is_custom: number;
  rsvp_reopened: number;
  status: EventStatus;
  visibility: Visibility;
  group_rsvp_mode: GroupRsvpMode;
  default_plus_one_policy: PlusOnePolicy;
  cancellation_message: string | null;
  theme: string;
  created_at: string;
  updated_at: string;
}

export function computeEffectiveStatus(event: EventRow): EventStatus {
  if (event.status === "cancelled" || event.status === "draft") return event.status;
  const start = eventStartDateTime(event.event_date, event.event_time);
  if (new Date() > start) return "completed";
  if (!event.rsvp_reopened && isPastDeadline(event.rsvp_deadline)) return "rsvp_closed";
  return "published";
}

export function createEvent(ownerId: string, input: {
  name: string;
  date: string;
  time: string;
  endTime?: string;
  description?: string;
  locationType: LocationType;
  venueName?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  meetingUrl?: string;
  meetingInstructions?: string;
  organizerName?: string;
  organizerContact?: string;
  website?: string;
  dressCode?: string;
  instructions?: string;
  rsvpDeadline?: string;
  visibility?: Visibility;
  groupRsvpMode?: GroupRsvpMode;
  defaultPlusOnePolicy?: PlusOnePolicy;
}): EventRow {
  const db = getDb();
  const id = newId("evt");
  const slug = uniqueSlugSync(input.name, id);
  const deadline = input.rsvpDeadline || defaultRsvpDeadline(input.date, input.time);
  const isCustom = !!input.rsvpDeadline;

  db.prepare(
    `INSERT INTO events (
      id, owner_id, name, slug, description, event_date, event_time, end_time,
      location_type, venue_name, address, city, state, zip, country,
      meeting_url, meeting_instructions, organizer_name, organizer_contact,
      website, dress_code, instructions, rsvp_deadline, rsvp_deadline_is_custom,
      status, visibility, group_rsvp_mode, default_plus_one_policy
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, ownerId, input.name, slug, input.description || null, input.date, input.time, input.endTime || null,
    input.locationType, input.venueName || null, input.address || null, input.city || null, input.state || null,
    input.zip || null, input.country || null, input.meetingUrl || null, input.meetingInstructions || null,
    input.organizerName || null, input.organizerContact || null, input.website || null, input.dressCode || null,
    input.instructions || null, deadline, isCustom ? 1 : 0, "draft",
    input.visibility || "invite_only", input.groupRsvpMode || "primary_contact", input.defaultPlusOnePolicy || "none"
  );

  db.prepare(
    `INSERT INTO event_members (id, event_id, user_id, invited_email, role, status) VALUES (?,?,?,?,?,?)`
  ).run(newId("mem"), id, ownerId, "", "owner", "active");

  return getEventById(id)!;
}

function uniqueSlugSync(name: string, excludeId?: string): string {
  const db = getDb();
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50) || "event";
  let slug = base;
  let n = 1;
  const exists = (s: string) => {
    const row = db.prepare("SELECT id FROM events WHERE slug = ? AND id != ?").get(s, excludeId || "") as { id: string } | undefined;
    return !!row;
  };
  while (exists(slug)) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

export function getEventById(id: string): EventRow | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM events WHERE id = ?").get(id) as EventRow | undefined;
}

export function getEventBySlug(slug: string): EventRow | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM events WHERE slug = ?").get(slug) as EventRow | undefined;
}

export function updateEvent(id: string, patch: Partial<EventRow>) {
  const db = getDb();
  const allowed = [
    "name", "description", "event_date", "event_time", "end_time", "location_type", "venue_name",
    "address", "city", "state", "zip", "country", "meeting_url", "meeting_instructions", "image_url",
    "organizer_name", "organizer_contact", "website", "dress_code", "instructions", "rsvp_deadline",
    "rsvp_deadline_is_custom", "status", "visibility", "group_rsvp_mode", "default_plus_one_policy",
    "cancellation_message", "theme", "rsvp_reopened",
  ];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (keys.length === 0) return;
  const setClause = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => (patch as any)[k]);
  db.prepare(`UPDATE events SET ${setClause}, updated_at = datetime('now') WHERE id = ?`).run(...values, id);
}

export function deleteEvent(id: string) {
  const db = getDb();
  db.prepare("DELETE FROM events WHERE id = ?").run(id);
}

export function listEventsForUser(userId: string): EventRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT e.* FROM events e
       JOIN event_members m ON m.event_id = e.id
       WHERE m.user_id = ? AND m.status = 'active'
       ORDER BY e.event_date ASC`
    )
    .all(userId) as EventRow[];
}

export function getMembership(eventId: string, userId: string): { role: Role } | undefined {
  const db = getDb();
  return db
    .prepare("SELECT role FROM event_members WHERE event_id = ? AND user_id = ? AND status = 'active'")
    .get(eventId, userId) as { role: Role } | undefined;
}

export function listMembers(eventId: string) {
  const db = getDb();
  return db
    .prepare(
      `SELECT em.id, em.role, em.status, em.invited_email, em.created_at,
              u.first_name, u.last_name, u.email, u.id as user_id
       FROM event_members em
       LEFT JOIN users u ON u.id = em.user_id
       WHERE em.event_id = ?
       ORDER BY CASE em.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, em.created_at ASC`
    )
    .all(eventId);
}

export function addCoPlanner(eventId: string, email: string, role: Exclude<Role, "owner">) {
  const db = getDb();
  const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase()) as { id: string } | undefined;
  const id = newId("mem");
  db.prepare(
    `INSERT INTO event_members (id, event_id, user_id, invited_email, role, status) VALUES (?,?,?,?,?,?)`
  ).run(id, eventId, user?.id || null, email.toLowerCase(), role, user ? "active" : "pending");
  return id;
}

export function removeCoPlanner(memberId: string) {
  const db = getDb();
  db.prepare("DELETE FROM event_members WHERE id = ? AND role != 'owner'").run(memberId);
}

export interface EventStats {
  invited: number;
  responded: number;
  attending: number;
  declined: number;
  noResponse: number;
  totalAttendees: number;
  responseRate: number;
}

export function getEventStats(eventId: string): EventStats {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT i.id as invitation_id,
        (SELECT r.attending FROM rsvp_responses r WHERE r.invitation_id = i.id ORDER BY r.responded_at DESC LIMIT 1) as attending,
        (SELECT r.num_attending FROM rsvp_responses r WHERE r.invitation_id = i.id ORDER BY r.responded_at DESC LIMIT 1) as num_attending
       FROM invitations i WHERE i.event_id = ?`
    )
    .all(eventId) as { invitation_id: string; attending: number | null; num_attending: number | null }[];

  let responded = 0, attending = 0, declined = 0, totalAttendees = 0;
  for (const r of rows) {
    if (r.attending === null) continue;
    responded += 1;
    if (r.attending) {
      attending += 1;
      totalAttendees += r.num_attending || 1;
    } else {
      declined += 1;
    }
  }
  const invited = rows.length;
  return {
    invited,
    responded,
    attending,
    declined,
    noResponse: invited - responded,
    totalAttendees,
    responseRate: invited > 0 ? Math.round((responded / invited) * 100) : 0,
  };
}

export function listAuditLogs(eventId: string, limit = 50) {
  const db = getDb();
  return db
    .prepare("SELECT * FROM audit_logs WHERE event_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(eventId, limit);
}

export function logAudit(eventId: string | null, actor: string, action: string, details?: string) {
  const db = getDb();
  db.prepare(`INSERT INTO audit_logs (id, event_id, actor, action, details) VALUES (?,?,?,?,?)`).run(
    newId("log"), eventId, actor, action, details || null
  );
}
