import { getDb } from "@/lib/db";
import { newId, newInviteToken } from "@/lib/utils";
import type { PlusOnePolicy } from "@/lib/models/events";

export interface InviteeRow {
  id: string;
  event_id: string;
  group_id: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  is_adult: number;
  plus_one_policy: PlusOnePolicy | null;
  notes: string | null;
  active: number;
  created_at: string;
}

export interface GroupRow {
  id: string;
  event_id: string;
  name: string;
  leader_invitee_id: string | null;
  created_at: string;
}

export interface InvitationRow {
  id: string;
  event_id: string;
  invitee_id: string | null;
  token: string;
  is_public_signup: number;
  status: string;
  opened_at: string | null;
  created_at: string;
}

export function createGroup(eventId: string, name: string): GroupRow {
  const db = getDb();
  const id = newId("grp");
  db.prepare("INSERT INTO groups (id, event_id, name) VALUES (?,?,?)").run(id, eventId, name);
  return db.prepare("SELECT * FROM groups WHERE id = ?").get(id) as GroupRow;
}

export function listGroups(eventId: string): GroupRow[] {
  const db = getDb();
  return db.prepare("SELECT * FROM groups WHERE event_id = ? ORDER BY name ASC").all(eventId) as GroupRow[];
}

export function setGroupLeader(groupId: string, inviteeId: string) {
  const db = getDb();
  db.prepare("UPDATE groups SET leader_invitee_id = ? WHERE id = ?").run(inviteeId, groupId);
}

export function createInvitee(
  eventId: string,
  input: {
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    isAdult?: boolean;
    plusOnePolicy?: PlusOnePolicy | null;
    notes?: string;
    groupId?: string | null;
  }
): { invitee: InviteeRow; invitation: InvitationRow } {
  const db = getDb();
  const id = newId("inv");
  db.prepare(
    `INSERT INTO invitees (id, event_id, group_id, first_name, last_name, email, phone, is_adult, plus_one_policy, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, eventId, input.groupId || null, input.firstName, input.lastName, input.email || null,
    input.phone || null, input.isAdult === false ? 0 : 1, input.plusOnePolicy || null, input.notes || null
  );

  const invitation = createInvitationFor(eventId, id);
  const invitee = db.prepare("SELECT * FROM invitees WHERE id = ?").get(id) as InviteeRow;
  return { invitee, invitation };
}

export function createInvitationFor(eventId: string, inviteeId: string): InvitationRow {
  const db = getDb();
  const id = newId("ivn");
  let token = newInviteToken();
  // ensure uniqueness (astronomically unlikely to collide, but be safe)
  while (db.prepare("SELECT id FROM invitations WHERE token = ?").get(token)) {
    token = newInviteToken();
  }
  db.prepare(
    `INSERT INTO invitations (id, event_id, invitee_id, token, status) VALUES (?,?,?,?, 'invited')`
  ).run(id, eventId, inviteeId, token);
  return db.prepare("SELECT * FROM invitations WHERE id = ?").get(id) as InvitationRow;
}

export function listInvitees(eventId: string): (InviteeRow & { token: string; status: string; group_name: string | null })[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT iv.*, g.name as group_name, i.token, i.status
       FROM invitees iv
       LEFT JOIN groups g ON g.id = iv.group_id
       LEFT JOIN invitations i ON i.invitee_id = iv.id
       WHERE iv.event_id = ? AND iv.active = 1
       ORDER BY iv.created_at ASC`
    )
    .all(eventId) as any;
}

export function getInviteeById(id: string): InviteeRow | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM invitees WHERE id = ?").get(id) as InviteeRow | undefined;
}

export function updateInvitee(id: string, patch: Partial<InviteeRow>) {
  const db = getDb();
  const allowed = ["first_name", "last_name", "email", "phone", "is_adult", "plus_one_policy", "notes", "group_id"];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (keys.length === 0) return;
  const setClause = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => (patch as any)[k]);
  db.prepare(`UPDATE invitees SET ${setClause} WHERE id = ?`).run(...values, id);
}

export function deactivateInvitee(id: string) {
  const db = getDb();
  db.prepare("UPDATE invitees SET active = 0 WHERE id = ?").run(id);
}

export function countActiveInvitees(eventId: string): number {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as c FROM invitees WHERE event_id = ? AND active = 1").get(eventId) as { c: number };
  return row.c;
}

export function getInvitationByToken(token: string): (InvitationRow & { invitee?: InviteeRow }) | undefined {
  const db = getDb();
  const invitation = db.prepare("SELECT * FROM invitations WHERE token = ?").get(token) as InvitationRow | undefined;
  if (!invitation) return undefined;
  const invitee = invitation.invitee_id
    ? (db.prepare("SELECT * FROM invitees WHERE id = ?").get(invitation.invitee_id) as InviteeRow | undefined)
    : undefined;
  return { ...invitation, invitee };
}

export function markInvitationOpened(id: string) {
  const db = getDb();
  const row = db.prepare("SELECT status, opened_at FROM invitations WHERE id = ?").get(id) as { status: string; opened_at: string | null };
  if (row && !row.opened_at) {
    db.prepare("UPDATE invitations SET opened_at = datetime('now'), status = CASE WHEN status = 'invited' THEN 'opened' ELSE status END WHERE id = ?").run(id);
  }
}

export function setInvitationStatus(id: string, status: string) {
  const db = getDb();
  db.prepare("UPDATE invitations SET status = ? WHERE id = ?").run(status, id);
}

export function groupMembers(groupId: string): InviteeRow[] {
  const db = getDb();
  return db.prepare("SELECT * FROM invitees WHERE group_id = ? AND active = 1 ORDER BY first_name ASC").all(groupId) as InviteeRow[];
}

export function createPublicSignupInvitation(eventId: string, inviteeId: string): InvitationRow {
  const db = getDb();
  const id = newId("ivn");
  let token = newInviteToken();
  while (db.prepare("SELECT id FROM invitations WHERE token = ?").get(token)) token = newInviteToken();
  db.prepare(
    `INSERT INTO invitations (id, event_id, invitee_id, token, is_public_signup, status) VALUES (?,?,?,?,1,'invited')`
  ).run(id, eventId, inviteeId, token);
  return db.prepare("SELECT * FROM invitations WHERE id = ?").get(id) as InvitationRow;
}
