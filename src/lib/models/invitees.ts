import { query, queryOne, exec } from "@/lib/db";
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
  custom_fields: string | null; // JSON object of {fieldKey: value}
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

export async function createGroup(eventId: string, name: string): Promise<GroupRow> {
  const id = newId("grp");
  await exec("INSERT INTO groups (id, event_id, name) VALUES (?,?,?)", [id, eventId, name]);
  return (await queryOne<GroupRow>("SELECT * FROM groups WHERE id = ?", [id]))!;
}

export async function listGroups(eventId: string): Promise<GroupRow[]> {
  return query<GroupRow>("SELECT * FROM groups WHERE event_id = ? ORDER BY name ASC", [eventId]);
}

export async function setGroupLeader(groupId: string, inviteeId: string) {
  await exec("UPDATE groups SET leader_invitee_id = ? WHERE id = ?", [inviteeId, groupId]);
}

export async function createInvitee(
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
    customFields?: Record<string, string>;
  }
): Promise<{ invitee: InviteeRow; invitation: InvitationRow }> {
  const id = newId("inv");
  await exec(
    `INSERT INTO invitees (id, event_id, group_id, first_name, last_name, email, phone, is_adult, plus_one_policy, notes, custom_fields)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, eventId, input.groupId || null, input.firstName, input.lastName, input.email || null,
      input.phone || null, input.isAdult === false ? 0 : 1, input.plusOnePolicy || null, input.notes || null,
      input.customFields && Object.keys(input.customFields).length ? JSON.stringify(input.customFields) : null,
    ]
  );

  const invitation = await createInvitationFor(eventId, id);
  const invitee = (await queryOne<InviteeRow>("SELECT * FROM invitees WHERE id = ?", [id]))!;
  return { invitee, invitation };
}

export async function createInvitationFor(eventId: string, inviteeId: string): Promise<InvitationRow> {
  const id = newId("ivn");
  let token = newInviteToken();
  // ensure uniqueness (astronomically unlikely to collide, but be safe)
  while (await queryOne("SELECT id FROM invitations WHERE token = ?", [token])) {
    token = newInviteToken();
  }
  await exec(
    `INSERT INTO invitations (id, event_id, invitee_id, token, status) VALUES (?,?,?,?, 'invited')`,
    [id, eventId, inviteeId, token]
  );
  return (await queryOne<InvitationRow>("SELECT * FROM invitations WHERE id = ?", [id]))!;
}

export async function listInvitees(eventId: string): Promise<(InviteeRow & { token: string; status: string; group_name: string | null })[]> {
  return query(
    `SELECT iv.*, g.name as group_name, i.token, i.status
     FROM invitees iv
     LEFT JOIN groups g ON g.id = iv.group_id
     LEFT JOIN invitations i ON i.invitee_id = iv.id
     WHERE iv.event_id = ? AND iv.active = 1
     ORDER BY iv.created_at ASC`,
    [eventId]
  );
}

export async function getInviteeById(id: string): Promise<InviteeRow | undefined> {
  return queryOne<InviteeRow>("SELECT * FROM invitees WHERE id = ?", [id]);
}

export async function updateInvitee(id: string, patch: Partial<InviteeRow>) {
  const allowed = ["first_name", "last_name", "email", "phone", "is_adult", "plus_one_policy", "notes", "group_id", "custom_fields"];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (keys.length === 0) return;
  const setClause = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => (patch as any)[k]);
  await exec(`UPDATE invitees SET ${setClause} WHERE id = ?`, [...values, id]);
}

export async function deactivateInvitee(id: string) {
  await exec("UPDATE invitees SET active = 0 WHERE id = ?", [id]);
}

export async function countActiveInvitees(eventId: string): Promise<number> {
  const row = await queryOne<{ c: string }>("SELECT COUNT(*) as c FROM invitees WHERE event_id = ? AND active = 1", [eventId]);
  return Number(row?.c || 0);
}

export async function getInvitationByToken(token: string): Promise<(InvitationRow & { invitee?: InviteeRow }) | undefined> {
  const invitation = await queryOne<InvitationRow>("SELECT * FROM invitations WHERE token = ?", [token]);
  if (!invitation) return undefined;
  const invitee = invitation.invitee_id
    ? await queryOne<InviteeRow>("SELECT * FROM invitees WHERE id = ?", [invitation.invitee_id])
    : undefined;
  return { ...invitation, invitee };
}

export async function markInvitationOpened(id: string) {
  const row = await queryOne<{ status: string; opened_at: string | null }>(
    "SELECT status, opened_at FROM invitations WHERE id = ?",
    [id]
  );
  if (row && !row.opened_at) {
    await exec(
      "UPDATE invitations SET opened_at = ?, status = CASE WHEN status = 'invited' THEN 'opened' ELSE status END WHERE id = ?",
      [new Date().toISOString(), id]
    );
  }
}

export async function setInvitationStatus(id: string, status: string) {
  await exec("UPDATE invitations SET status = ? WHERE id = ?", [status, id]);
}

export async function groupMembers(groupId: string): Promise<InviteeRow[]> {
  return query<InviteeRow>("SELECT * FROM invitees WHERE group_id = ? AND active = 1 ORDER BY first_name ASC", [groupId]);
}

export async function createPublicSignupInvitation(eventId: string, inviteeId: string): Promise<InvitationRow> {
  const id = newId("ivn");
  let token = newInviteToken();
  while (await queryOne("SELECT id FROM invitations WHERE token = ?", [token])) token = newInviteToken();
  await exec(
    `INSERT INTO invitations (id, event_id, invitee_id, token, is_public_signup, status) VALUES (?,?,?,?,1,'invited')`,
    [id, eventId, inviteeId, token]
  );
  return (await queryOne<InvitationRow>("SELECT * FROM invitations WHERE id = ?", [id]))!;
}
