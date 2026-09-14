import { query, queryOne, exec } from "@/lib/db";
import { newId } from "@/lib/utils";

export interface AssemblyRow {
  id: string;
  event_id: string;
  name: string;
  created_at: string;
}

export async function createAssembly(eventId: string, name: string): Promise<AssemblyRow> {
  const id = newId("asm");
  await exec("INSERT INTO assemblies (id, event_id, name) VALUES (?,?,?)", [id, eventId, name]);
  return (await getAssembly(id))!;
}

export async function listAssemblies(eventId: string): Promise<AssemblyRow[]> {
  return query<AssemblyRow>("SELECT * FROM assemblies WHERE event_id = ? ORDER BY created_at ASC", [eventId]);
}

export async function getAssembly(id: string): Promise<AssemblyRow | undefined> {
  return queryOne<AssemblyRow>("SELECT * FROM assemblies WHERE id = ?", [id]);
}

export async function countAssemblies(eventId: string): Promise<number> {
  const row = await queryOne<{ c: string }>("SELECT COUNT(*) as c FROM assemblies WHERE event_id = ?", [eventId]);
  return Number(row?.c || 0);
}

export async function renameAssembly(id: string, name: string) {
  await exec("UPDATE assemblies SET name = ? WHERE id = ?", [name, id]);
}

/** Deleting an assembly un-assigns its invitees/groups (kept, just no longer scoped) and revokes
 * any lead planner whose membership was scoped to it (cascades via event_members.assembly_id FK). */
export async function deleteAssembly(id: string) {
  await exec("DELETE FROM assemblies WHERE id = ?", [id]);
}

export interface AssemblyStats {
  invited: number;
  responded: number;
  attending: number;
  declined: number;
  noResponse: number;
  totalAttendees: number;
  responseRate: number;
}

export async function getAssemblyStats(eventId: string, assemblyId: string | null): Promise<AssemblyStats> {
  const rows = await query<{ invitation_id: string; attending: number | null; num_attending: number | null }>(
    `SELECT i.id as invitation_id,
      (SELECT r.attending FROM rsvp_responses r WHERE r.invitation_id = i.id ORDER BY r.responded_at DESC LIMIT 1) as attending,
      (SELECT r.num_attending FROM rsvp_responses r WHERE r.invitation_id = i.id ORDER BY r.responded_at DESC LIMIT 1) as num_attending
     FROM invitations i
     JOIN invitees iv ON iv.id = i.invitee_id
     WHERE i.event_id = ? AND iv.active = 1 AND iv.assembly_id ${assemblyId ? "= ?" : "IS NULL"}`,
    assemblyId ? [eventId, assemblyId] : [eventId]
  );

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
