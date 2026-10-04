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
  paid_on: string | null;      // YYYY-MM-DD the money changed hands (backfilled from recorded_at)
  method: string | null;       // see src/lib/payment-methods.ts; NULL for payments that predate it
  method_other: string | null; // description when method = 'other'
  kind: "payment" | "refund";
  donation_cents: number;      // part of amount_cents belonging to the donations bucket (see schema.sql)
}

/** SQL for one ledger row's effect on *ticket* balances: refunds subtract, and any donation portion
 * never counts toward tickets. Every ticket sum in this file goes through this, so donations can't
 * leak into a balance. `a` is the ticket_payments table alias. */
const ticketNet = (a: string) => `(CASE WHEN ${a}.kind = 'refund' THEN -1 ELSE 1 END) * (${a}.amount_cents - ${a}.donation_cents)`;
/** Same, for the donations bucket. */
const donationNet = (a: string) => `(CASE WHEN ${a}.kind = 'refund' THEN -1 ELSE 1 END) * ${a}.donation_cents`;

export const DEFAULT_DONATIONS_LABEL = "Donations/Tips";

export interface PaymentAllocation { invitee_id: string; amount_cents: number; }
export type PaymentWithAllocations = TicketPaymentRow & { allocations: PaymentAllocation[] };

export interface TicketingConfig {
  enabled: boolean;
  field: InviteeFieldRow | null;
  tiers: TicketTierRow[];
  donations: { enabled: boolean; label: string };
}

/** Tiers are authored here and pushed into the linked field's options_json (see createTier/
 * deleteTier below) — the field's options are never edited directly once linked (blocked in
 * src/app/api/events/[id]/invitee-fields/[fieldId]/route.ts), so there's nothing to reconcile
 * at read time; this is just a straightforward join. */
export async function getTicketingConfig(eventId: string): Promise<TicketingConfig> {
  const event = await getEventById(eventId);
  const enabled = !!event?.ticketing_enabled;
  const field = event?.ticket_field_id ? (await getInviteeField(event.ticket_field_id)) || null : null;
  const donations = { enabled: !!event?.donations_enabled, label: event?.donations_label || DEFAULT_DONATIONS_LABEL };

  if (!enabled || !field) {
    return { enabled, field: null, tiers: [], donations };
  }

  const tiers = await listTicketTiersForField(field.id);
  return { enabled, field, tiers, donations };
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
  paidOn: string;
  method: string;
  methodOther?: string;
  note?: string;
  recordedBy: string;
  kind?: "payment" | "refund";
  donationCents?: number; // 0..amountCents — callers validate
}): Promise<TicketPaymentRow> {
  if (!!input.inviteeId === !!input.groupId) throw new Error("Exactly one of inviteeId/groupId must be set.");
  const id = newId("pay");
  await exec(
    `INSERT INTO ticket_payments (id, event_id, invitee_id, group_id, amount_cents, paid_on, method, method_other, note, recorded_by, kind, donation_cents)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, input.eventId, input.inviteeId || null, input.groupId || null, input.amountCents, input.paidOn, input.method,
      input.method === "other" ? input.methodOther || null : null, input.note || null, input.recordedBy,
      input.kind || "payment", input.donationCents || 0]
  );
  return (await queryOne<TicketPaymentRow>("SELECT * FROM ticket_payments WHERE id = ?", [id]))!;
}

export async function getPayment(id: string): Promise<TicketPaymentRow | undefined> {
  return queryOne<TicketPaymentRow>("SELECT * FROM ticket_payments WHERE id = ?", [id]);
}

export async function updatePayment(id: string, patch: {
  amountCents?: number; note?: string | null; paidOn?: string; method?: string; methodOther?: string | null; donationCents?: number;
}): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];
  if (patch.amountCents !== undefined) { fields.push("amount_cents = ?"); values.push(patch.amountCents); }
  if (patch.donationCents !== undefined) { fields.push("donation_cents = ?"); values.push(patch.donationCents); }
  if (patch.note !== undefined) { fields.push("note = ?"); values.push(patch.note); }
  if (patch.paidOn !== undefined) { fields.push("paid_on = ?"); values.push(patch.paidOn); }
  if (patch.method !== undefined) {
    fields.push("method = ?", "method_other = ?");
    values.push(patch.method, patch.method === "other" ? patch.methodOther || null : null);
  }
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

export async function listAllocations(paymentId: string): Promise<PaymentAllocation[]> {
  return query<PaymentAllocation>(
    "SELECT invitee_id, amount_cents FROM ticket_payment_allocations WHERE payment_id = ? ORDER BY created_at ASC",
    [paymentId]
  );
}

/** Replaces a group payment's custom split wholesale. Callers validate first (group payment, not
 * voided, every invitee an active member of that group, total <= the payment amount). */
export async function replaceAllocations(paymentId: string, allocations: { inviteeId: string; amountCents: number }[]): Promise<void> {
  await exec("DELETE FROM ticket_payment_allocations WHERE payment_id = ?", [paymentId]);
  for (const a of allocations) {
    await exec(
      "INSERT INTO ticket_payment_allocations (id, payment_id, invitee_id, amount_cents) VALUES (?,?,?,?)",
      [newId("alc"), paymentId, a.inviteeId, a.amountCents]
    );
  }
}

/** Every payment for one invitee or group, newest payment date first, each with its custom split. */
export async function listPaymentsWithAllocations(
  target: { inviteeId: string } | { groupId: string },
  includeVoided = false
): Promise<PaymentWithAllocations[]> {
  const [col, id] = "inviteeId" in target ? ["invitee_id", target.inviteeId] : ["group_id", target.groupId];
  const payments = await query<TicketPaymentRow>(
    `SELECT * FROM ticket_payments WHERE ${col} = ? ${includeVoided ? "" : "AND voided_at IS NULL"}
     ORDER BY voided_at IS NOT NULL, paid_on DESC, recorded_at DESC`,
    [id]
  );
  if (payments.length === 0) return [];
  const allocs = await query<PaymentAllocation & { payment_id: string }>(
    `SELECT payment_id, invitee_id, amount_cents FROM ticket_payment_allocations
     WHERE payment_id IN (${payments.map(() => "?").join(",")}) ORDER BY created_at ASC`,
    payments.map((p) => p.id)
  );
  return payments.map((p) => ({
    ...p,
    allocations: allocs.filter((a) => a.payment_id === p.id).map(({ invitee_id, amount_cents }) => ({ invitee_id, amount_cents })),
  }));
}

export interface DonationEntry {
  paymentId: string;
  paidOn: string | null;
  who: string;
  targetType: "invitee" | "group";
  kind: "payment" | "refund";
  source: "overpayment" | "direct" | "refund";
  donationCents: number;   // positive; refunds are subtracted by the caller
  totalCents: number;      // the whole transaction it was part of
  method: string | null;
  methodOther: string | null;
  note: string | null;
}

/** Every non-voided transaction that touched the donations bucket, newest first — the list behind
 * the summary card's Donations figure. */
export async function listDonations(eventId: string, assemblyId?: string | null): Promise<DonationEntry[]> {
  const rows = await query<TicketPaymentRow & { first_name: string | null; last_name: string | null; group_name: string | null }>(
    `SELECT tp.*, iv.first_name, iv.last_name, g.name as group_name
     FROM ticket_payments tp
     LEFT JOIN invitees iv ON iv.id = tp.invitee_id
     LEFT JOIN groups g ON g.id = tp.group_id
     WHERE tp.event_id = ? AND tp.voided_at IS NULL AND tp.donation_cents > 0
     ${assemblyId ? "AND COALESCE(iv.assembly_id, g.assembly_id) = ?" : ""}
     ORDER BY tp.paid_on DESC, tp.recorded_at DESC`,
    assemblyId ? [eventId, assemblyId] : [eventId]
  );
  return rows.map((r) => ({
    paymentId: r.id,
    paidOn: r.paid_on,
    who: r.group_id ? r.group_name || "Group" : fullName(r.first_name || "", r.last_name || ""),
    targetType: r.group_id ? "group" : "invitee",
    kind: r.kind,
    source: r.kind === "refund" ? "refund" : r.donation_cents >= r.amount_cents ? "direct" : "overpayment",
    donationCents: r.donation_cents,
    totalCents: r.amount_cents,
    method: r.method,
    methodOther: r.method_other,
    note: r.note,
  }));
}

/** What one invitee or group could be refunded from each bucket: the net of *their own* ledger rows
 * (a group's figure is only payments tagged to the group itself, not its members' own payments). */
export async function refundableFor(target: { inviteeId: string } | { groupId: string }): Promise<{ ticketCents: number; donationCents: number }> {
  const [col, id] = "inviteeId" in target ? ["invitee_id", target.inviteeId] : ["group_id", target.groupId];
  const row = await queryOne<{ t: string | null; d: string | null }>(
    `SELECT SUM(${ticketNet("tp")}) as t, SUM(${donationNet("tp")}) as d FROM ticket_payments tp
     WHERE tp.${col} = ? AND tp.voided_at IS NULL`,
    [id]
  );
  return { ticketCents: Math.max(0, Number(row?.t || 0)), donationCents: Math.max(0, Number(row?.d || 0)) };
}

/** Sets each invitee's ticket tier — their value for the linked ticketing field. `tier` must be one
 * of the configured tier names, or "" to clear it. Merges into custom_fields (never trusting it to
 * be a JSON object — see CLAUDE.md), so every other custom field is preserved. */
export async function setTicketTiers(eventId: string, assignments: { inviteeId: string; tier: string }[]): Promise<void> {
  const config = await getTicketingConfig(eventId);
  if (!config.enabled || !config.field) throw new Error("Ticketing isn't set up for this event.");
  const key = config.field.key;
  for (const a of assignments) {
    const row = await queryOne<{ custom_fields: string | null }>(
      "SELECT custom_fields FROM invitees WHERE id = ? AND event_id = ?",
      [a.inviteeId, eventId]
    );
    if (!row) continue;
    let custom: Record<string, string> = {};
    try {
      const parsed = row.custom_fields ? JSON.parse(row.custom_fields) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) custom = parsed;
    } catch {}
    if (a.tier) custom[key] = a.tier; else delete custom[key];
    await exec("UPDATE invitees SET custom_fields = ? WHERE id = ?", [Object.keys(custom).length ? JSON.stringify(custom) : null, a.inviteeId]);
  }
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
    `SELECT tp.invitee_id, SUM(${ticketNet("tp")}) as total
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
    `SELECT tp.group_id, SUM(${ticketNet("tp")}) as total
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
  rsvpStatus: "attending" | "declined" | "maybe" | null; // latest response; null = no response yet
}

export interface TicketingSummaryGroup {
  groupId: string;
  name: string;
  memberCount: number;
  tierBreakdown: { tier: string; count: number }[];
  owedCents: number;
  paidCents: number;
  balanceCents: number;
  memberRsvpStatuses: ("attending" | "declined" | "maybe" | null)[];
}

/** The Tickets tab's summary card. Expected counts everyone except people who declined; Outstanding
 * and Credits are per *party* (a group as one unit, an ungrouped invitee as another) so one family's
 * overpayment never hides another's balance. Donations are tracked entirely separately. */
export interface TicketingTotals {
  expectedCents: number;
  collectedCents: number;
  outstandingCents: number;
  creditCents: number;
  donationsCents: number;
  declinedExcluded: number;
}

export interface TicketingSummary {
  enabled: boolean;
  fieldLabel: string | null;
  fieldKey: string | null;
  tiers: { name: string; priceCents: number }[];
  donations: { enabled: boolean; label: string };
  totals: TicketingTotals;
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
  // The group's net donations (shown to guests as a thank-you line); null when the bucket is off and empty.
  donation: { label: string; cents: number } | null;
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
    queryOne<{ total: string | null; donated: string | null }>(
      `SELECT SUM(${ticketNet("tp")}) as total, SUM(${donationNet("tp")}) as donated
       FROM ticket_payments tp WHERE tp.group_id = ? AND tp.voided_at IS NULL`,
      [groupId]
    ),
    query<{ invitee_id: string; total: string; donated: string }>(
      `SELECT tp.invitee_id, SUM(${ticketNet("tp")}) as total, SUM(${donationNet("tp")}) as donated FROM ticket_payments tp
       JOIN invitees iv ON iv.id = tp.invitee_id
       WHERE iv.group_id = ? AND iv.active = 1 AND tp.voided_at IS NULL
       GROUP BY tp.invitee_id`,
      [groupId]
    ),
  ]);
  const paidByInvitee = Object.fromEntries(memberPaid.map((r) => [r.invitee_id, Number(r.total)]));
  const { owedCents, paidCents } = groupTotals(members, Number(groupPaid?.total || 0), paidByInvitee, fieldKey, config.tiers);
  const donatedCents = Number(groupPaid?.donated || 0) + memberPaid.reduce((sum, r) => sum + Number(r.donated || 0), 0);
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
    donation: config.donations.enabled || donatedCents > 0 ? { label: config.donations.label, cents: donatedCents } : null,
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
    return {
      enabled: config.enabled, fieldLabel: null, fieldKey: null, tiers: [], donations: config.donations,
      totals: { expectedCents: 0, collectedCents: 0, outstandingCents: 0, creditCents: 0, donationsCents: 0, declinedExcluded: 0 },
      invitees: [], groups: [], hasGroups: false,
    };
  }
  const fieldKey = config.field.key;

  const [rows, groupRows, paidByInvitee, paidByGroup, donated, allocations] = await Promise.all([
    listInviteeResponseRows(eventId, assemblyId),
    listGroups(eventId, assemblyId),
    sumPaymentsByInvitee(eventId, assemblyId),
    sumPaymentsByGroup(eventId, assemblyId),
    queryOne<{ total: string | null }>(
      `SELECT SUM(${donationNet("tp")}) as total FROM ticket_payments tp
       LEFT JOIN invitees iv ON iv.id = tp.invitee_id
       LEFT JOIN groups g ON g.id = tp.group_id
       WHERE tp.event_id = ? AND tp.voided_at IS NULL
       ${assemblyId ? "AND COALESCE(iv.assembly_id, g.assembly_id) = ?" : ""}`,
      assemblyId ? [eventId, assemblyId] : [eventId]
    ),
    query<{ group_id: string; invitee_id: string; amount_cents: number }>(
      `SELECT p.group_id, a.invitee_id, a.amount_cents FROM ticket_payment_allocations a
       JOIN ticket_payments p ON p.id = a.payment_id
       WHERE p.event_id = ? AND p.group_id IS NOT NULL AND p.voided_at IS NULL`,
      [eventId]
    ),
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
    let groupShareCents = 0;
    if (row.group_id && members && members.length > 0) {
      // Custom-split portions go straight to their member; only what's left of the group's payments
      // is shared equally. An allocation to someone no longer an active member of this group falls
      // back into the equal pool, so the current members' shares always add up to the group total.
      const memberIds = new Set(members.map((m) => m.invitee_id));
      const valid = allocations.filter((a) => a.group_id === row.group_id && memberIds.has(a.invitee_id));
      const pool = (paidByGroup[row.group_id] || 0) - valid.reduce((sum, a) => sum + a.amount_cents, 0);
      const mine = valid.filter((a) => a.invitee_id === row.invitee_id).reduce((sum, a) => sum + a.amount_cents, 0);
      groupShareCents = mine + Math.round(pool / members.length);
    }
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
      rsvpStatus: row.rsvp_status,
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

    return {
      groupId: g.id, name: g.name, memberCount: members.length, tierBreakdown, owedCents, paidCents, balanceCents: owedCents - paidCents,
      memberRsvpStatuses: members.map((m) => m.rsvp_status),
    };
  });

  // ---- Summary card ----
  const notDeclined = (r: (typeof rows)[number]) => r.rsvp_status !== "declined";
  const priceOf = (r: (typeof rows)[number]) => priceForInvitee(r.custom_fields, fieldKey, config.tiers);
  const groupIds = new Set(groupRows.map((g) => g.id));
  let expectedCents = 0, outstandingCents = 0, creditCents = 0;
  const party = (owed: number, paid: number) => {
    const bal = owed - paid;
    if (bal > 0) outstandingCents += bal; else creditCents += -bal;
  };
  for (const r of rows) if (notDeclined(r)) expectedCents += priceOf(r);
  for (const g of groupRows) {
    const members = membersByGroup.get(g.id) || [];
    const owed = members.filter(notDeclined).reduce((sum, m) => sum + priceOf(m), 0);
    const paid = (paidByGroup[g.id] || 0) + members.reduce((sum, m) => sum + (paidByInvitee[m.invitee_id] || 0), 0);
    party(owed, paid);
  }
  for (const r of rows) {
    if (r.group_id && groupIds.has(r.group_id)) continue;
    party(notDeclined(r) ? priceOf(r) : 0, paidByInvitee[r.invitee_id] || 0);
  }
  const collectedCents =
    rows.reduce((sum, r) => sum + (paidByInvitee[r.invitee_id] || 0), 0) +
    groupRows.reduce((sum, g) => sum + (paidByGroup[g.id] || 0), 0);

  return {
    enabled: true, fieldLabel: config.field.label, fieldKey,
    tiers: config.tiers.map((t) => ({ name: t.option_value, priceCents: t.price_cents })),
    donations: config.donations,
    totals: {
      expectedCents, collectedCents, outstandingCents, creditCents,
      donationsCents: Number(donated?.total || 0),
      declinedExcluded: rows.filter((r) => !notDeclined(r)).length,
    },
    invitees, groups, hasGroups: groups.length > 0,
  };
}
