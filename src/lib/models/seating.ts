import { query, queryOne, exec, transaction, type Tx } from "@/lib/db";
import { newId, fullName } from "@/lib/utils";
import { seatsFor, type SeatingGuest, type SeatingItem, type SeatingKind } from "@/lib/seating";

/** A refusal the route should pass straight back to the planner (capacity, scope, stale request). */
export class SeatingError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

// ---------- Floor items ----------

export async function listItems(eventId: string): Promise<SeatingItem[]> {
  const rows = await query<SeatingItem>(
    `SELECT id, kind, shape, label, capacity, assembly_id, x, y, width, height, rotation
     FROM seating_items WHERE event_id = ? ORDER BY created_at ASC, id ASC`,
    [eventId]
  );
  return rows.map(normalizeItem);
}

function normalizeItem(r: any): SeatingItem {
  return { ...r, x: Number(r.x), y: Number(r.y), width: Number(r.width), height: Number(r.height), rotation: Number(r.rotation), capacity: r.capacity === null ? null : Number(r.capacity) };
}

export async function getItem(id: string): Promise<(SeatingItem & { event_id: string }) | undefined> {
  const row = await queryOne("SELECT * FROM seating_items WHERE id = ?", [id]);
  return row ? { ...normalizeItem(row), event_id: row.event_id } : undefined;
}

export interface NewItem {
  kind: SeatingKind; shape: string; label: string; capacity: number | null; assembly_id: string | null;
  x: number; y: number; width: number; height: number; rotation: number;
}

export async function createItems(eventId: string, items: NewItem[]): Promise<SeatingItem[]> {
  const created: SeatingItem[] = [];
  await transaction(async (tx) => {
    for (const it of items) {
      const id = newId("seat");
      await tx.exec(
        `INSERT INTO seating_items (id, event_id, kind, shape, label, capacity, assembly_id, x, y, width, height, rotation)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, eventId, it.kind, it.shape, it.label, it.kind === "table" ? it.capacity : null, it.kind === "table" ? it.assembly_id : null, it.x, it.y, it.width, it.height, it.rotation]
      );
      created.push({ id, ...it, capacity: it.kind === "table" ? it.capacity : null, assembly_id: it.kind === "table" ? it.assembly_id : null });
    }
  });
  return created;
}

export async function updateItem(id: string, patch: Partial<Omit<NewItem, "kind">>) {
  const allowed = ["shape", "label", "capacity", "assembly_id", "x", "y", "width", "height", "rotation"] as const;
  const keys = allowed.filter((k) => k in patch);
  if (keys.length === 0) return;
  await exec(
    `UPDATE seating_items SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`,
    [...keys.map((k) => (patch as any)[k]), new Date().toISOString(), id]
  );
}

/** Several items at once (a group move, or setting a clone on a selection) — all or nothing. Only
 * rows of this event are touched. */
export async function updateItems(eventId: string, updates: ({ id: string } & Partial<Omit<NewItem, "kind">>)[]) {
  const allowed = ["shape", "label", "capacity", "assembly_id", "x", "y", "width", "height", "rotation"] as const;
  const now = new Date().toISOString();
  await transaction(async (tx) => {
    for (const { id, ...patch } of updates) {
      const keys = allowed.filter((k) => k in patch);
      if (keys.length === 0) continue;
      await tx.exec(
        `UPDATE seating_items SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ? AND event_id = ?`,
        [...keys.map((k) => (patch as any)[k]), now, id, eventId]
      );
    }
  });
}

export async function deleteItems(eventId: string, ids: string[]) {
  await exec("DELETE FROM seating_items WHERE event_id = ? AND id = ANY(?)", [eventId, ids]);
  await supersedeStaleRequests(eventId);
}

/** Its guests become unseated (the assignment FK cascades); requests naming it go stale. */
export async function deleteItem(eventId: string, id: string) {
  await exec("DELETE FROM seating_items WHERE id = ? AND event_id = ?", [id, eventId]);
  await supersedeStaleRequests(eventId);
}

// ---------- Guests ----------

// Every active invitee with their latest RSVP and current table. Same "earliest invitation, latest
// response" rule as listInvitees, so status here always matches the Invitees tab.
const GUEST_SELECT = `
  SELECT iv.id, iv.first_name, iv.last_name, iv.assembly_id, iv.group_id, g.name as group_name,
         r.rsvp_status, r.num_attending, sa.table_id
  FROM invitees iv
  LEFT JOIN groups g ON g.id = iv.group_id
  LEFT JOIN seating_assignments sa ON sa.invitee_id = iv.id
  LEFT JOIN invitations i ON i.id = (
    SELECT i2.id FROM invitations i2 WHERE i2.invitee_id = iv.id ORDER BY i2.created_at ASC LIMIT 1
  )
  LEFT JOIN rsvp_responses r ON r.id = (
    SELECT r2.id FROM rsvp_responses r2 WHERE r2.invitation_id = i.id ORDER BY r2.responded_at DESC LIMIT 1
  )`;

export async function listSeatingGuests(eventId: string, assemblyId: string | null): Promise<SeatingGuest[]> {
  return query<SeatingGuest>(
    `${GUEST_SELECT} WHERE iv.event_id = ? AND iv.active = 1 ${assemblyId ? "AND iv.assembly_id = ?" : ""}
     ORDER BY lower(iv.first_name), lower(iv.last_name)`,
    assemblyId ? [eventId, assemblyId] : [eventId]
  );
}

/** Chairs taken and guests seated per table, across the whole event (no names — a clone planner
 * sees these numbers for tables holding other clones' guests). */
export async function tableUsage(eventId: string): Promise<Record<string, { seats: number; guests: number }>> {
  const rows = await query<SeatingGuest>(`${GUEST_SELECT} WHERE iv.event_id = ? AND iv.active = 1 AND sa.table_id IS NOT NULL`, [eventId]);
  const usage: Record<string, { seats: number; guests: number }> = {};
  for (const r of rows) {
    const u = (usage[r.table_id!] ||= { seats: 0, guests: 0 });
    u.seats += seatsFor(r);
    u.guests += 1;
  }
  return usage;
}

// ---------- Seating ----------

/** Locks the table, then refuses if seating `incoming` there would put it over capacity. Guests
 * already at that table aren't double-counted. Must run inside the same transaction as the write. */
async function checkCapacity(tx: Tx, eventId: string, tableId: string, incoming: SeatingGuest[]) {
  const [table] = await tx.query("SELECT label, capacity, kind FROM seating_items WHERE id = ? AND event_id = ? FOR UPDATE", [tableId, eventId]);
  if (!table || table.kind !== "table") throw new SeatingError("That table no longer exists.", 404);
  if (table.capacity === null) return;
  const incomingIds = new Set(incoming.map((g) => g.id));
  const seated = await tx.query<SeatingGuest>(`${GUEST_SELECT} WHERE iv.event_id = ? AND iv.active = 1 AND sa.table_id = ?`, [eventId, tableId]);
  const used = seated.filter((g) => !incomingIds.has(g.id)).reduce((n, g) => n + seatsFor(g), 0);
  const need = incoming.reduce((n, g) => n + seatsFor(g), 0);
  if (used + need > Number(table.capacity)) {
    const left = Math.max(0, Number(table.capacity) - used);
    throw new SeatingError(`${table.label} has ${left} seat${left === 1 ? "" : "s"} left — ${need === 1 ? "that needs 1" : `that needs ${need}`}. Raise its capacity or pick another table.`, 409);
  }
}

async function loadGuests(tx: Tx, eventId: string, ids: string[]): Promise<SeatingGuest[]> {
  if (ids.length === 0) return [];
  const rows = await tx.query<SeatingGuest>(`${GUEST_SELECT} WHERE iv.event_id = ? AND iv.active = 1 AND iv.id = ANY(?)`, [eventId, ids]);
  if (rows.length !== new Set(ids).size) throw new SeatingError("Some of these guests are no longer on the guest list. Refresh and try again.", 404);
  return rows;
}

async function writeSeats(tx: Tx, eventId: string, guests: SeatingGuest[], tableId: string | null, actor: string) {
  const ids = guests.map((g) => g.id);
  if (ids.length === 0) return;
  if (tableId === null) {
    await tx.exec("DELETE FROM seating_assignments WHERE invitee_id = ANY(?)", [ids]);
    return;
  }
  const now = new Date().toISOString();
  for (const id of ids) {
    await tx.exec(
      `INSERT INTO seating_assignments (invitee_id, event_id, table_id, assigned_by, assigned_at) VALUES (?,?,?,?,?)
       ON CONFLICT (invitee_id) DO UPDATE SET table_id = EXCLUDED.table_id, assigned_by = EXCLUDED.assigned_by, assigned_at = EXCLUDED.assigned_at`,
      [id, eventId, tableId, actor, now]
    );
  }
}

export interface SeatActor { email: string; assemblyId: string | null; }

/** Seat (tableId) or unseat (null) guests. Owner/admin (assemblyId null): applied at once. A clone
 * planner: only their own clone's guests and tables set aside for their clone; seating someone with
 * no table yet applies at once, but moving/unseating someone already seated becomes a request. */
export async function seatGuests(eventId: string, inviteeIds: string[], tableId: string | null, actor: SeatActor) {
  const result = await transaction(async (tx) => {
    const guests = await loadGuests(tx, eventId, inviteeIds);
    if (actor.assemblyId) {
      if (guests.some((g) => g.assembly_id !== actor.assemblyId)) throw new SeatingError("You can only seat guests from your own clone.", 403);
      if (tableId) {
        const [t] = await tx.query("SELECT assembly_id FROM seating_items WHERE id = ? AND event_id = ? AND kind = 'table'", [tableId, eventId]);
        if (!t) throw new SeatingError("That table no longer exists.", 404);
        if (t.assembly_id !== actor.assemblyId) throw new SeatingError("That table isn't set aside for your clone. Ask the event owner to set it aside for you.", 403);
      }
    }
    const changing = guests.filter((g) => g.table_id !== tableId);
    const direct = actor.assemblyId ? changing.filter((g) => !g.table_id) : changing;
    const asks = actor.assemblyId ? changing.filter((g) => g.table_id) : [];

    if (tableId && direct.length) await checkCapacity(tx, eventId, tableId, direct);
    await writeSeats(tx, eventId, direct, tableId, actor.email);

    for (const g of asks) {
      // A newer request for the same guest replaces the older one.
      await tx.exec("UPDATE seating_requests SET status = 'withdrawn', decided_by = ?, decided_at = ? WHERE invitee_id = ? AND status = 'pending'",
        [actor.email, new Date().toISOString(), g.id]);
      await tx.exec(
        `INSERT INTO seating_requests (id, event_id, invitee_id, assembly_id, from_table_id, to_table_id, requested_by) VALUES (?,?,?,?,?,?,?)`,
        [newId("sreq"), eventId, g.id, actor.assemblyId, g.table_id, tableId, actor.email]
      );
    }
    return { seated: direct.length, requested: asks.length };
  });
  await supersedeStaleRequests(eventId);
  return result;
}

// ---------- Requests ----------

export interface SeatingRequestRow {
  id: string;
  invitee_id: string;
  invitee_name: string;
  assembly_id: string | null;
  from_table_id: string | null;
  to_table_id: string | null;
  requested_by: string;
  requested_at: string;
}

export async function listPendingRequests(eventId: string, assemblyId: string | null): Promise<SeatingRequestRow[]> {
  const rows = await query(
    `SELECT sr.id, sr.invitee_id, sr.assembly_id, sr.from_table_id, sr.to_table_id, sr.requested_by, sr.requested_at,
            iv.first_name, iv.last_name
     FROM seating_requests sr JOIN invitees iv ON iv.id = sr.invitee_id
     WHERE sr.event_id = ? AND sr.status = 'pending' ${assemblyId ? "AND sr.assembly_id = ?" : ""}
     ORDER BY sr.requested_at ASC`,
    assemblyId ? [eventId, assemblyId] : [eventId]
  );
  return rows.map(({ first_name, last_name, ...r }) => ({ ...r, invitee_name: fullName(first_name, last_name) }));
}

// A pending request no longer describes a real change once its guest was removed or moved clone,
// someone already moved them off the table it was made from, or its destination table is gone or no
// longer set aside for that clone.
const STALE = `(
  NOT EXISTS (SELECT 1 FROM invitees iv WHERE iv.id = sr.invitee_id AND iv.active = 1 AND iv.assembly_id IS NOT DISTINCT FROM sr.assembly_id)
  OR (SELECT sa.table_id FROM seating_assignments sa WHERE sa.invitee_id = sr.invitee_id) IS DISTINCT FROM sr.from_table_id
  OR (sr.to_table_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM seating_items si WHERE si.id = sr.to_table_id AND si.assembly_id IS NOT DISTINCT FROM sr.assembly_id))
)`;

/** Marks stale requests (see STALE) 'superseded'. Checked lazily — on load and after every seating
 * write — so no other part of the app (RSVP submits, invitee edits) has to know requests exist. */
export async function supersedeStaleRequests(eventId: string) {
  await exec(
    `UPDATE seating_requests sr SET status = 'superseded', decided_at = ?
     WHERE sr.event_id = ? AND sr.status = 'pending' AND ${STALE}`,
    [new Date().toISOString(), eventId]
  );
}

/** For the Seating tab's badge (owner only): pending requests that are still current — read-only, so
 * the event layout can call it on every page without writing. */
export async function countPendingRequests(eventId: string): Promise<number> {
  const row = await queryOne<{ c: string }>(
    `SELECT COUNT(*) as c FROM seating_requests sr WHERE sr.event_id = ? AND sr.status = 'pending' AND NOT ${STALE}`,
    [eventId]
  );
  return Number(row?.c || 0);
}

export async function getRequest(id: string) {
  return queryOne<{ id: string; event_id: string; assembly_id: string | null; status: string; requested_by: string }>(
    "SELECT id, event_id, assembly_id, status, requested_by FROM seating_requests WHERE id = ?", [id]
  );
}

/** Owner only. Approving re-checks the request is still current and the table still has room. */
export async function decideRequest(eventId: string, requestId: string, approve: boolean, actorEmail: string) {
  await supersedeStaleRequests(eventId);
  await transaction(async (tx) => {
    const [req] = await tx.query("SELECT * FROM seating_requests WHERE id = ? AND event_id = ? FOR UPDATE", [requestId, eventId]);
    if (!req) throw new SeatingError("That request no longer exists.", 404);
    if (req.status === "superseded") throw new SeatingError("This request is out of date — the guest or table changed since it was made.", 409);
    if (req.status !== "pending") throw new SeatingError("This request was already handled.", 409);
    if (approve) {
      const [guest] = await loadGuests(tx, eventId, [req.invitee_id]);
      if (req.to_table_id) await checkCapacity(tx, eventId, req.to_table_id, [guest]);
      await writeSeats(tx, eventId, [guest], req.to_table_id, actorEmail);
    }
    await tx.exec("UPDATE seating_requests SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?",
      [approve ? "approved" : "rejected", actorEmail, new Date().toISOString(), requestId]);
  });
}

export async function withdrawRequest(requestId: string, actorEmail: string) {
  await exec("UPDATE seating_requests SET status = 'withdrawn', decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'",
    [actorEmail, new Date().toISOString(), requestId]);
}
