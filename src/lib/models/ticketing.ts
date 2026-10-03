import { query, queryOne, exec } from "@/lib/db";
import { newId, fullName } from "@/lib/utils";
import { getEventById, updateEvent } from "@/lib/models/events";
import { getInviteeField, createInviteeField, updateInviteeField, type InviteeFieldRow } from "@/lib/models/invitee-fields";
import { listGroups } from "@/lib/models/invitees";
import type { InviteeRow } from "@/lib/models/invitees";
import { listInviteeResponseRows } from "@/lib/models/rsvp";

export interface TicketTierRow {
  id: string;
  event_id: string;
  field_id: string;
  option_value: string;
  price_cents: number;
  created_at: string;
  updated_at: string;
}

export interface TicketPaymentRow {
  id: string;
  event_id: string;
  invitee_id: string | null;
  group_id: string | null;
  amount_cents: number;
  note: string | null;
  recorded_by: string;
  recorded_at: string;
  updated_at: string;
  voided_at: string | null;
  voided_by: string | null;
}

export interface TicketingConfig {
  enabled: boolean;
  field: InviteeFieldRow | null;
  tiers: TicketTierRow[];
}

/** Tiers are authored here and pushed into the linked field's options_json (see createTier/
 * deleteTier below) — the field's options are never edited directly once linked (blocked in
 * src/app/api/events/[id]/invitee-fields/[fieldId]/route.ts), so there's nothing to reconcile
 * at read time; this is just a straightforward join. */
export async function getTicketingConfig(eventId: string): Promise<TicketingConfig> {
  const event = await getEventById(eventId);
  const enabled = !!event?.ticketing_enabled;
  const field = event?.ticket_field_id ? (await getInviteeField(event.ticket_field_id)) || null : null;

  if (!enabled || !field) {
    return { enabled, field: null, tiers: [] };
  }

  const tiers = await listTicketTiersForField(field.id);
  return { enabled, field, tiers };
}

export async function listTicketTiers(eventId: string): Promise<TicketTierRow[]> {
  return query<TicketTierRow>("SELECT * FROM ticket_tiers WHERE event_id = ? ORDER BY option_value ASC", [eventId]);
}

async function listTicketTiersForField(fieldId: string): Promise<TicketTierRow[]> {
  return query<TicketTierRow>("SELECT * FROM ticket_tiers WHERE field_id = ? ORDER BY option_value ASC", [fieldId]);
}

export async function upsertTicketTier(eventId: string, fieldId: string, optionValue: string, priceCents: number): Promise<TicketTierRow> {
  const existing = await queryOne<TicketTierRow>("SELECT * FROM ticket_tiers WHERE field_id = ? AND option_value = ?", [fieldId, optionValue]);
  const now = new Date().toISOString();
  if (existing) {
    await exec("UPDATE ticket_tiers SET price_cents = ?, updated_at = ? WHERE id = ?", [priceCents, now, existing.id]);
    return (await queryOne<TicketTierRow>("SELECT * FROM ticket_tiers WHERE id = ?", [existing.id]))!;
  }
  const id = newId("tier");
  await exec(
    "INSERT INTO ticket_tiers (id, event_id, field_id, option_value, price_cents) VALUES (?,?,?,?,?)",
    [id, eventId, fieldId, optionValue, priceCents]
  );
  return (await queryOne<TicketTierRow>("SELECT * FROM ticket_tiers WHERE id = ?", [id]))!;
}

export async function deleteTicketTier(id: string): Promise<void> {
  await exec("DELETE FROM ticket_tiers WHERE id = ?", [id]);
}

/** Creates a tier and pushes its name into the linked field's dropdown options — the field is
 * the byproduct here, not the source of truth. If no field is linked yet, creates one (a normal
 * custom dropdown invitee field, indistinguishable from any other) and links it. Tier names are
 * immutable after creation (only price can change) — renaming would mean reconciling every
 * invitee already holding the old option string, the same problem field-driven drift used to
 * cause; delete-and-recreate is the simplest, least surprising path if a name is wrong. */
export async function createTier(eventId: string, input: {
  fieldId?: string | null;
  fieldLabel?: string;
  optionValue: string;
  priceCents: number;
}): Promise<TicketingConfig> {
  let fieldId = input.fieldId || null;

  if (!fieldId) {
    const field = await createInviteeField(eventId, {
      label: input.fieldLabel || "Ticket Type",
      field_type: "dropdown",
      options: [input.optionValue],
      collectAtSignup: false,
    });
    fieldId = field.id;
    await updateEvent(eventId, { ticketing_enabled: 1, ticket_field_id: fieldId });
  } else {
    const field = await getInviteeField(fieldId);
    const current: string[] = field?.options_json ? JSON.parse(field.options_json) : [];
    if (!current.includes(input.optionValue)) {
      await updateInviteeField(fieldId, { options: [...current, input.optionValue] });
    }
  }

  await upsertTicketTier(eventId, fieldId, input.optionValue, input.priceCents);
  return getTicketingConfig(eventId);
}

export async function updateTierPrice(tierId: string, priceCents: number): Promise<void> {
  await exec("UPDATE ticket_tiers SET price_cents = ?, updated_at = ? WHERE id = ?", [priceCents, new Date().toISOString(), tierId]);
}

/** Removes a tier and its option from the linked field. Invitees already holding that value keep
 * it in their custom_fields untouched (same as removing any option from any other dropdown field
 * today) — it'll just show as unpriced wherever tier/owed amount is displayed. */
export async function deleteTier(tierId: string): Promise<void> {
  const tier = await queryOne<TicketTierRow>("SELECT * FROM ticket_tiers WHERE id = ?", [tierId]);
  if (!tier) return;
  const field = await getInviteeField(tier.field_id);
  if (field) {
    const current: string[] = field.options_json ? JSON.parse(field.options_json) : [];
    await updateInviteeField(field.id, { options: current.filter((o) => o !== tier.option_value) });
  }
  await deleteTicketTier(tierId);
}

/** Links ticketing to an already-existing dropdown field instead of creating a dedicated one —
 * seeds a $0 tier for each of its current options (planner fills in prices from there), then from
 * this point on the field's options are managed exclusively via the tier list like any other
 * ticketing-created field. */
export async function adoptFieldAsTicketing(eventId: string, fieldId: string): Promise<TicketingConfig> {
  const field = await getInviteeField(fieldId);
  const options: string[] = field?.options_json ? JSON.parse(field.options_json) : [];
  for (const option of options) {
    const existing = await queryOne<TicketTierRow>("SELECT * FROM ticket_tiers WHERE field_id = ? AND option_value = ?", [fieldId, option]);
    if (!existing) await upsertTicketTier(eventId, fieldId, option, 0);
  }
  await updateEvent(eventId, { ticket_field_id: fieldId });
  return getTicketingConfig(eventId);
}

/** Unlinks the field without deleting existing tier rows, so re-linking the same field later
 * restores prices as-is. The field itself becomes directly editable via Manage Fields again once
 * unlinked (see the options-edit guard in the invitee-fields route). */
export async function unlinkField(eventId: string): Promise<TicketingConfig> {
  await updateEvent(eventId, { ticket_field_id: null });
  return getTicketingConfig(eventId);
}

/** Pure — no DB call, safe to run over a whole invitee list in a loop. Looks up the invitee's
 * value for the linked field and matches it to a configured tier; an invitee with no value set
 * (or a value that matches no tier, e.g. after drift) owes $0 — never an error, never blocking. */
export function priceForInvitee(customFieldsJson: string | null, fieldKey: string, tiers: TicketTierRow[]): number {
  if (!customFieldsJson) return 0;
  let value: string | undefined;
  try {
    const parsed = JSON.parse(customFieldsJson);
    value = parsed && typeof parsed === "object" ? parsed[fieldKey] : undefined;
  } catch {
    return 0;
  }
  if (!value) return 0;
  const tier = tiers.find((t) => t.option_value === value);
  return tier?.price_cents ?? 0;
}

export function priceForGroup(members: Pick<InviteeRow, "custom_fields">[], fieldKey: string, tiers: TicketTierRow[]): number {
  return members.reduce((sum, m) => sum + priceForInvitee(m.custom_fields, fieldKey, tiers), 0);
}

export async function createPayment(input: {
  eventId: string;
  inviteeId?: string;
  groupId?: string;
  amountCents: number;
  note?: string;
  recordedBy: string;
}): Promise<TicketPaymentRow> {
  if (!!input.inviteeId === !!input.groupId) throw new Error("Exactly one of inviteeId/groupId must be set.");
  const id = newId("pay");
  await exec(
    "INSERT INTO ticket_payments (id, event_id, invitee_id, group_id, amount_cents, note, recorded_by) VALUES (?,?,?,?,?,?,?)",
    [id, input.eventId, input.inviteeId || null, input.groupId || null, input.amountCents, input.note || null, input.recordedBy]
  );
  return (await queryOne<TicketPaymentRow>("SELECT * FROM ticket_payments WHERE id = ?", [id]))!;
}

export async function getPayment(id: string): Promise<TicketPaymentRow | undefined> {
  return queryOne<TicketPaymentRow>("SELECT * FROM ticket_payments WHERE id = ?", [id]);
}

export async function updatePayment(id: string, patch: { amountCents?: number; note?: string }): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];
  if (patch.amountCents !== undefined) { fields.push("amount_cents = ?"); values.push(patch.amountCents); }
  if (patch.note !== undefined) { fields.push("note = ?"); values.push(patch.note); }
  if (fields.length === 0) return;
  fields.push("updated_at = ?");
  values.push(new Date().toISOString());
  await exec(`UPDATE ticket_payments SET ${fields.join(", ")} WHERE id = ? AND voided_at IS NULL`, [...values, id]);
}

export async function voidPayment(id: string, actorEmail: string): Promise<void> {
  await exec(
    "UPDATE ticket_payments SET voided_at = ?, voided_by = ? WHERE id = ? AND voided_at IS NULL",
    [new Date().toISOString(), actorEmail, id]
  );
}

export async function listPaymentsForInvitee(inviteeId: string, includeVoided = false): Promise<TicketPaymentRow[]> {
  if (includeVoided) return query<TicketPaymentRow>("SELECT * FROM ticket_payments WHERE invitee_id = ? ORDER BY recorded_at DESC", [inviteeId]);
  return query<TicketPaymentRow>("SELECT * FROM ticket_payments WHERE invitee_id = ? AND voided_at IS NULL ORDER BY recorded_at DESC", [inviteeId]);
}

export async function listPaymentsForGroup(groupId: string, includeVoided = false): Promise<TicketPaymentRow[]> {
  if (includeVoided) return query<TicketPaymentRow>("SELECT * FROM ticket_payments WHERE group_id = ? ORDER BY recorded_at DESC", [groupId]);
  return query<TicketPaymentRow>("SELECT * FROM ticket_payments WHERE group_id = ? AND voided_at IS NULL ORDER BY recorded_at DESC", [groupId]);
}

/** One aggregate query for the whole event, rather than N per-invitee queries — used by the
 * Responses page to compute every row's "Paid" total at once. */
export async function sumPaymentsByInvitee(eventId: string, assemblyId?: string | null): Promise<Record<string, number>> {
  const rows = await query<{ invitee_id: string; total: string }>(
    `SELECT tp.invitee_id, SUM(tp.amount_cents) as total
     FROM ticket_payments tp
     ${assemblyId ? "JOIN invitees iv ON iv.id = tp.invitee_id" : ""}
     WHERE tp.event_id = ? AND tp.invitee_id IS NOT NULL AND tp.voided_at IS NULL
     ${assemblyId ? "AND iv.assembly_id = ?" : ""}
     GROUP BY tp.invitee_id`,
    assemblyId ? [eventId, assemblyId] : [eventId]
  );
  return Object.fromEntries(rows.map((r) => [r.invitee_id, Number(r.total)]));
}

export async function sumPaymentsByGroup(eventId: string, assemblyId?: string | null): Promise<Record<string, number>> {
  const rows = await query<{ group_id: string; total: string }>(
    `SELECT tp.group_id, SUM(tp.amount_cents) as total
     FROM ticket_payments tp
     ${assemblyId ? "JOIN groups g ON g.id = tp.group_id" : ""}
     WHERE tp.event_id = ? AND tp.group_id IS NOT NULL AND tp.voided_at IS NULL
     ${assemblyId ? "AND g.assembly_id = ?" : ""}
     GROUP BY tp.group_id`,
    assemblyId ? [eventId, assemblyId] : [eventId]
  );
  return Object.fromEntries(rows.map((r) => [r.group_id, Number(r.total)]));
}

export interface TicketingSummaryInvitee {
  inviteeId: string;
  name: string;
  groupId: string | null;
  groupName: string | null;
  tier: string;
  owedCents: number;
  paidCents: number;
  groupShareCents: number;
  balanceCents: number;
}

export interface TicketingSummaryGroup {
  groupId: string;
  name: string;
  memberCount: number;
  tierBreakdown: { tier: string; count: number }[];
  owedCents: number;
  paidCents: number;
  balanceCents: number;
}

export interface TicketingSummary {
  enabled: boolean;
  fieldLabel: string | null;
  fieldKey: string | null;
  invitees: TicketingSummaryInvitee[];
  groups: TicketingSummaryGroup[];
  hasGroups: boolean;
}

function tierValueFromCustomFields(customFieldsJson: string | null, fieldKey: string): string {
  if (!customFieldsJson) return "";
  try {
    const parsed = JSON.parse(customFieldsJson);
    const value = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed[fieldKey] : undefined;
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

/** The one rule for a group's totals — shared by the Tickets tab's group rows (getTicketingSummary)
 * and the guest-facing group RSVP link (getGroupTicketBalance), so the two can never disagree.
 * Owed = every current member's own tier price; Paid = payments tagged to the group itself plus
 * each current member's individually-tagged payments. */
function groupTotals(
  members: { invitee_id: string; custom_fields: string | null }[],
  groupPaidCents: number,
  paidByInvitee: Record<string, number>,
  fieldKey: string,
  tiers: TicketTierRow[]
): { owedCents: number; paidCents: number } {
  const owedCents = priceForGroup(members, fieldKey, tiers);
  const paidCents = groupPaidCents + members.reduce((sum, m) => sum + (paidByInvitee[m.invitee_id] || 0), 0);
  return { owedCents, paidCents };
}

export interface GroupTicketBalance {
  members: { inviteeId: string; name: string; tier: string; priceCents: number }[];
  owedCents: number;
  paidCents: number;
  balanceCents: number;
}

/** One group's ticket price, payments, and balance, for the public group RSVP link. Null when the
 * event has no ticketing configured. Members are the group's *active* invitees — the same set
 * listInviteeResponseRows gives getTicketingSummary. */
export async function getGroupTicketBalance(eventId: string, groupId: string): Promise<GroupTicketBalance | null> {
  const config = await getTicketingConfig(eventId);
  if (!config.enabled || !config.field) return null;
  const fieldKey = config.field.key;
  const [members, groupPaid, memberPaid] = await Promise.all([
    query<{ invitee_id: string; first_name: string; last_name: string; custom_fields: string | null }>(
      `SELECT id as invitee_id, first_name, last_name, custom_fields FROM invitees
       WHERE group_id = ? AND active = 1 ORDER BY added_by_guest ASC, created_at ASC`,
      [groupId]
    ),
    queryOne<{ total: string | null }>(
      "SELECT SUM(amount_cents) as total FROM ticket_payments WHERE group_id = ? AND voided_at IS NULL",
      [groupId]
    ),
    query<{ invitee_id: string; total: string }>(
      `SELECT tp.invitee_id, SUM(tp.amount_cents) as total FROM ticket_payments tp
       JOIN invitees iv ON iv.id = tp.invitee_id
       WHERE iv.group_id = ? AND iv.active = 1 AND tp.voided_at IS NULL
       GROUP BY tp.invitee_id`,
      [groupId]
    ),
  ]);
  const paidByInvitee = Object.fromEntries(memberPaid.map((r) => [r.invitee_id, Number(r.total)]));
  const { owedCents, paidCents } = groupTotals(members, Number(groupPaid?.total || 0), paidByInvitee, fieldKey, config.tiers);
  return {
    members: members.map((m) => ({
      inviteeId: m.invitee_id,
      name: fullName(m.first_name, m.last_name),
      tier: tierValueFromCustomFields(m.custom_fields, fieldKey),
      priceCents: priceForInvitee(m.custom_fields, fieldKey, config.tiers),
    })),
    owedCents,
    paidCents,
    balanceCents: owedCents - paidCents,
  };
}

/** Powers the Tickets tab. Owed always reflects each invitee's own ticket-tier price
 * (unchanged) — only Paid attributes a live equal share of any group-tagged payment to
 * each of the group's *current* members, so nothing needs to be recomputed or migrated
 * when a member is later added to or removed from a group: the next read just divides by
 * however many active members the group has at that moment. A member's own individually-
 * tagged payments always add on top of that share. Per-member group shares are rounded for
 * display only (Math.round(total/n)) and can therefore sum to within ±(n-1) cents of the
 * group's own exact total shown on its own row — that row is never the sum of the rounded
 * shares, it's the real total, so nothing is actually lost or gained. */
export async function getTicketingSummary(eventId: string, assemblyId?: string | null): Promise<TicketingSummary> {
  const config = await getTicketingConfig(eventId);
  if (!config.enabled || !config.field) {
    return { enabled: config.enabled, fieldLabel: null, fieldKey: null, invitees: [], groups: [], hasGroups: false };
  }
  const fieldKey = config.field.key;

  const [rows, groupRows, paidByInvitee, paidByGroup] = await Promise.all([
    listInviteeResponseRows(eventId, assemblyId),
    listGroups(eventId, assemblyId),
    sumPaymentsByInvitee(eventId, assemblyId),
    sumPaymentsByGroup(eventId, assemblyId),
  ]);

  const membersByGroup = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.group_id) continue;
    const list = membersByGroup.get(row.group_id);
    if (list) list.push(row);
    else membersByGroup.set(row.group_id, [row]);
  }

  const invitees: TicketingSummaryInvitee[] = rows.map((row) => {
    const tier = tierValueFromCustomFields(row.custom_fields, fieldKey);
    const owedCents = priceForInvitee(row.custom_fields, fieldKey, config.tiers);
    const individualPaid = paidByInvitee[row.invitee_id] || 0;
    const members = row.group_id ? membersByGroup.get(row.group_id) : undefined;
    const groupShareCents = row.group_id && members && members.length > 0
      ? Math.round((paidByGroup[row.group_id] || 0) / members.length)
      : 0;
    const paidCents = individualPaid + groupShareCents;
    return {
      inviteeId: row.invitee_id,
      name: fullName(row.first_name, row.last_name),
      groupId: row.group_id,
      groupName: row.group_name,
      tier,
      owedCents,
      paidCents,
      groupShareCents,
      balanceCents: owedCents - paidCents,
    };
  });

  const groups: TicketingSummaryGroup[] = groupRows.map((g) => {
    const members = membersByGroup.get(g.id) || [];
    const { owedCents, paidCents } = groupTotals(members, paidByGroup[g.id] || 0, paidByInvitee, fieldKey, config.tiers);

    const tierCounts = new Map<string, number>();
    for (const m of members) {
      const t = tierValueFromCustomFields(m.custom_fields, fieldKey);
      tierCounts.set(t, (tierCounts.get(t) || 0) + 1);
    }
    const tierBreakdown = [...tierCounts.entries()]
      .map(([tier, count]) => ({ tier, count }))
      .sort((a, b) => {
        if (a.tier === "" || b.tier === "") return a.tier === "" ? 1 : -1;
        return b.count - a.count || a.tier.localeCompare(b.tier);
      });

    return { groupId: g.id, name: g.name, memberCount: members.length, tierBreakdown, owedCents, paidCents, balanceCents: owedCents - paidCents };
  });

  return { enabled: true, fieldLabel: config.field.label, fieldKey, invitees, groups, hasGroups: groups.length > 0 };
}
