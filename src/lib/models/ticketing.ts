import { query, queryOne, exec } from "@/lib/db";
import { newId } from "@/lib/utils";
import { getEventById } from "@/lib/models/events";
import { getInviteeField, type InviteeFieldRow } from "@/lib/models/invitee-fields";
import type { InviteeRow } from "@/lib/models/invitees";

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
  currentOptions: string[];
  missingOptions: string[];
  orphanedTiers: TicketTierRow[];
}

/** Computes drift at read time (no triggers/webhooks anywhere in this codebase) between the
 * linked field's current dropdown options and the prices already configured for them, so the
 * Overview ticketing UI is always accurate relative to whatever the Fields manager currently has. */
export async function getTicketingConfig(eventId: string): Promise<TicketingConfig> {
  const event = await getEventById(eventId);
  const enabled = !!event?.ticketing_enabled;
  const field = event?.ticket_field_id ? (await getInviteeField(event.ticket_field_id)) || null : null;

  if (!enabled || !field) {
    return { enabled, field: null, tiers: [], currentOptions: [], missingOptions: [], orphanedTiers: [] };
  }

  const currentOptions: string[] = field.options_json ? JSON.parse(field.options_json) : [];
  const tiers = await listTicketTiersForField(field.id);
  const tierByOption = new Map(tiers.map((t) => [t.option_value, t]));
  const missingOptions = currentOptions.filter((o) => !tierByOption.has(o));
  const orphanedTiers = tiers.filter((t) => !currentOptions.includes(t.option_value));

  return { enabled, field, tiers, currentOptions, missingOptions, orphanedTiers };
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
