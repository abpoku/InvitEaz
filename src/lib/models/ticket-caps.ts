import { query, queryOne, exec } from "@/lib/db";
import { newId } from "@/lib/utils";
import { getTicketingConfig } from "@/lib/models/ticketing";
import { getAssembly, listAssemblies } from "@/lib/models/assemblies";
import {
  findBreach, countFor, plannerBreachMessage, guestBreachMessage,
  type TicketCap, type Holder,
} from "@/lib/ticket-caps";

/** One invitee's ticket-relevant state. `tier` is "" when they hold no configured ticket type. */
interface InviteeTicketState { assemblyId: string | null; tier: string; attending: boolean }

/** A proposed change to one invitee. Only the fields given change; `removed` = soft-deleted. */
export interface TicketChange {
  inviteeId: string;
  attending?: boolean;
  tier?: string | null;
  assemblyId?: string | null;
  removed?: boolean;
}

export async function listCaps(eventId: string): Promise<TicketCap[]> {
  const rows = await query<{ assembly_id: string | null; tier: string | null; cap: number }>(
    "SELECT assembly_id, tier, cap FROM ticket_caps WHERE event_id = ?",
    [eventId]
  );
  return rows.map((r) => ({ assemblyId: r.assembly_id, tier: r.tier, cap: Number(r.cap) }));
}

/** Replaces every limit for the event. Callers validate first (non-negative whole numbers, known clones
 * and tiers). */
export async function replaceCaps(eventId: string, caps: TicketCap[]): Promise<void> {
  await exec("DELETE FROM ticket_caps WHERE event_id = ?", [eventId]);
  for (const c of caps) {
    await exec(
      "INSERT INTO ticket_caps (id, event_id, assembly_id, tier, cap) VALUES (?,?,?,?,?)",
      [newId("cap"), eventId, c.assemblyId, c.tier, c.cap]
    );
  }
}

function tierOf(customFieldsJson: string | null, fieldKey: string, tierNames: Set<string>): string {
  if (!customFieldsJson) return "";
  try {
    const parsed = JSON.parse(customFieldsJson);
    const v = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed[fieldKey] : undefined;
    return typeof v === "string" && tierNames.has(v) ? v : "";
  } catch {
    return "";
  }
}

/** Every active invitee's ticket state, or null when ticketing isn't set up (then nothing is limited). */
async function loadStates(eventId: string) {
  const config = await getTicketingConfig(eventId);
  if (!config.enabled || !config.field) return null;
  const tierNames = new Set(config.tiers.map((t) => t.option_value));
  const rows = await query<{ id: string; assembly_id: string | null; custom_fields: string | null; rsvp_status: string | null }>(
    `SELECT iv.id, iv.assembly_id, iv.custom_fields,
       (SELECT r.rsvp_status FROM rsvp_responses r JOIN invitations i ON i.id = r.invitation_id
         WHERE i.invitee_id = iv.id ORDER BY r.responded_at DESC LIMIT 1) as rsvp_status
     FROM invitees iv WHERE iv.event_id = ? AND iv.active = 1`,
    [eventId]
  );
  const states = new Map<string, InviteeTicketState>();
  for (const r of rows) {
    states.set(r.id, { assemblyId: r.assembly_id, tier: tierOf(r.custom_fields, config.field.key, tierNames), attending: r.rsvp_status === "attending" });
  }
  return { tierNames, states };
}

function holders(states: Map<string, InviteeTicketState>): Holder[] {
  const out: Holder[] = [];
  for (const s of states.values()) if (s.attending && s.tier) out.push({ assemblyId: s.assemblyId, tier: s.tier });
  return out;
}

/** Checks a change against the event's ticket limits before anything is written. Returns null when
 * it fits (or there are no limits), else the message to show — detailed for planners, plain for
 * guests (`group`: the household link's wording). */
export async function checkTicketCaps(
  eventId: string,
  changes: TicketChange[],
  audience: "planner" | "guest",
  opts: { group?: boolean } = {}
): Promise<string | null> {
  if (changes.length === 0) return null;
  const caps = await listCaps(eventId);
  if (caps.length === 0) return null;
  const loaded = await loadStates(eventId);
  if (!loaded) return null;
  const { tierNames, states } = loaded;

  const after = new Map(states);
  for (const ch of changes) {
    const current = after.get(ch.inviteeId);
    if (!current) continue;
    if (ch.removed) { after.delete(ch.inviteeId); continue; }
    const next = { ...current };
    if (ch.attending !== undefined) next.attending = ch.attending;
    if (ch.tier !== undefined) next.tier = ch.tier && tierNames.has(ch.tier) ? ch.tier : "";
    if (ch.assemblyId !== undefined) next.assemblyId = ch.assemblyId;
    after.set(ch.inviteeId, next);
  }

  // A limit on a ticket type that no longer exists can never be reached — ignore it.
  const live = caps.filter((c) => c.tier === null || tierNames.has(c.tier));
  const breach = findBreach(live, holders(states), holders(after));
  if (!breach) return null;
  if (audience === "guest") return guestBreachMessage(breach, opts.group);
  const cloneName = breach.cap.assemblyId ? (await getAssembly(breach.cap.assemblyId))?.name : null;
  return plannerBreachMessage(breach, cloneName);
}

/** For the Ticket limits grid: the limits plus how many tickets are taken in every cell — rows are
 * the whole event and each clone, columns are all types and each type — whether or not it has a limit. */
export async function getCapsOverview(eventId: string) {
  const [caps, loaded, clones, config] = await Promise.all([
    listCaps(eventId), loadStates(eventId), listAssemblies(eventId), getTicketingConfig(eventId),
  ]);
  const tiers = config.tiers.map((t) => t.option_value);
  const taken = loaded ? holders(loaded.states) : [];
  const used: Record<string, number> = {};
  for (const assemblyId of [null, ...clones.map((c) => c.id)]) {
    for (const tier of [null, ...tiers]) used[capKey(assemblyId, tier)] = countFor({ assemblyId, tier }, taken);
  }
  return {
    caps: caps.filter((c) => c.tier === null || tiers.includes(c.tier)),
    tiers,
    clones: clones.map((c) => ({ id: c.id, name: c.name })),
    used,
  };
}

export function capKey(assemblyId: string | null, tier: string | null): string {
  return `${assemblyId ?? ""}|${tier ?? ""}`;
}

/** The ticketing field's key, or null when ticketing isn't set up — for routes that write custom fields
 * and need to know whether a ticket type is among them. */
export async function ticketFieldKey(eventId: string): Promise<string | null> {
  const config = await getTicketingConfig(eventId);
  return config.enabled && config.field ? config.field.key : null;
}

/** The ticket type held in a custom-fields JSON string (or object), or null for none. */
export function tierInCustomFields(customFields: string | Record<string, unknown> | null | undefined, fieldKey: string): string | null {
  let obj: unknown = customFields;
  if (typeof customFields === "string") {
    try { obj = JSON.parse(customFields); } catch { return null; }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const v = (obj as Record<string, unknown>)[fieldKey];
  return typeof v === "string" && v ? v : null;
}

/** The invitee an invitation belongs to (planner status changes act on invitations). */
export async function inviteeIdForInvitation(invitationId: string): Promise<string | null> {
  const row = await queryOne<{ invitee_id: string | null }>("SELECT invitee_id FROM invitations WHERE id = ?", [invitationId]);
  return row?.invitee_id ?? null;
}
