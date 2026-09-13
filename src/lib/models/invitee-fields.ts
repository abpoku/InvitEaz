import { query, queryOne, exec } from "@/lib/db";
import { newId } from "@/lib/utils";

export type InviteeFieldType = "text" | "email" | "phone" | "number" | "date" | "dropdown" | "checkbox";
export type InviteeFieldKind = "core" | "custom";

export interface InviteeFieldRow {
  id: string;
  event_id: string;
  key: string;
  label: string;
  kind: InviteeFieldKind;
  field_type: InviteeFieldType;
  options_json: string | null;
  required: number;
  collect_at_signup: number;
  order_index: number;
  active: number;
  created_at: string;
}

/** The always-present core fields, seeded once per event on first read. Planners can toggle
 * active/required/collect_at_signup and reorder them, but not rename or delete them — "Name"
 * itself isn't a row here; its shape is controlled by events.invitee_name_format instead.
 * `collectAtSignup` defaults match today's public self-signup form (name/email/phone only) so
 * enabling this feature doesn't silently add new questions to a form guests already see. */
const CORE_FIELD_DEFAULTS: { key: string; label: string; field_type: InviteeFieldType; options?: string[]; collectAtSignup: boolean }[] = [
  { key: "email", label: "Email", field_type: "email", collectAtSignup: true },
  { key: "phone", label: "Phone", field_type: "phone", collectAtSignup: true },
  { key: "group", label: "Group / household", field_type: "text", collectAtSignup: false },
  { key: "is_adult", label: "Adult or child", field_type: "dropdown", options: ["Adult", "Child"], collectAtSignup: false },
  { key: "plus_one_policy", label: "Plus-one policy", field_type: "dropdown", options: ["Use event default", "No plus-ones", "May bring one", "May bring multiple"], collectAtSignup: false },
  { key: "notes", label: "Notes", field_type: "text", collectAtSignup: false },
];

async function seedDefaultsIfMissing(eventId: string) {
  const existing = await queryOne<{ c: string }>("SELECT COUNT(*) as c FROM invitee_fields WHERE event_id = ?", [eventId]);
  if (Number(existing?.c || 0) > 0) return;
  for (let i = 0; i < CORE_FIELD_DEFAULTS.length; i++) {
    const f = CORE_FIELD_DEFAULTS[i];
    await exec(
      `INSERT INTO invitee_fields (id, event_id, key, label, kind, field_type, options_json, required, collect_at_signup, order_index, active)
       VALUES (?,?,?,?,'core',?,?,0,?,?,1)
       ON CONFLICT (event_id, key) DO NOTHING`,
      [newId("fld"), eventId, f.key, f.label, f.field_type, f.options ? JSON.stringify(f.options) : null, f.collectAtSignup ? 1 : 0, i]
    );
  }
}

export async function listInviteeFields(eventId: string): Promise<InviteeFieldRow[]> {
  await seedDefaultsIfMissing(eventId);
  return query<InviteeFieldRow>("SELECT * FROM invitee_fields WHERE event_id = ? ORDER BY order_index ASC", [eventId]);
}

export async function createInviteeField(eventId: string, input: {
  label: string; field_type: InviteeFieldType; options?: string[]; required?: boolean; collectAtSignup?: boolean;
}): Promise<InviteeFieldRow> {
  await seedDefaultsIfMissing(eventId);
  const id = newId("fld");
  const key = await uniqueCustomKey(eventId, input.label);
  const maxOrder = await queryOne<{ m: number }>("SELECT COALESCE(MAX(order_index), -1) as m FROM invitee_fields WHERE event_id = ?", [eventId]);
  await exec(
    `INSERT INTO invitee_fields (id, event_id, key, label, kind, field_type, options_json, required, collect_at_signup, order_index, active)
     VALUES (?,?,?,?,'custom',?,?,?,?,?,1)`,
    [id, eventId, key, input.label, input.field_type, input.options ? JSON.stringify(input.options) : null,
      input.required ? 1 : 0, input.collectAtSignup === false ? 0 : 1, (maxOrder?.m ?? -1) + 1]
  );
  return (await queryOne<InviteeFieldRow>("SELECT * FROM invitee_fields WHERE id = ?", [id]))!;
}

async function uniqueCustomKey(eventId: string, label: string): Promise<string> {
  const base = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "field";
  let key = base;
  let n = 1;
  while (await queryOne("SELECT id FROM invitee_fields WHERE event_id = ? AND key = ?", [eventId, key])) {
    n += 1;
    key = `${base}_${n}`;
  }
  return key;
}

export async function getInviteeField(id: string): Promise<InviteeFieldRow | undefined> {
  return queryOne<InviteeFieldRow>("SELECT * FROM invitee_fields WHERE id = ?", [id]);
}

/** Core fields may only have active/required/collect_at_signup/order_index changed — their
 * label/type/key stay fixed since app logic (audience filters, plus-one caps, grouping) depends on them. */
export async function updateInviteeField(id: string, patch: Partial<{
  label: string; field_type: InviteeFieldType; options: string[]; required: boolean; collectAtSignup: boolean; order_index: number; active: boolean;
}>) {
  const field = await getInviteeField(id);
  if (!field) return;
  const isCore = field.kind === "core";

  const fields: string[] = [];
  const values: any[] = [];
  if (!isCore && patch.label !== undefined) { fields.push("label = ?"); values.push(patch.label); }
  if (!isCore && patch.field_type !== undefined) { fields.push("field_type = ?"); values.push(patch.field_type); }
  if (!isCore && patch.options !== undefined) { fields.push("options_json = ?"); values.push(JSON.stringify(patch.options)); }
  if (patch.required !== undefined) { fields.push("required = ?"); values.push(patch.required ? 1 : 0); }
  if (patch.collectAtSignup !== undefined) { fields.push("collect_at_signup = ?"); values.push(patch.collectAtSignup ? 1 : 0); }
  if (patch.order_index !== undefined) { fields.push("order_index = ?"); values.push(patch.order_index); }
  if (patch.active !== undefined) { fields.push("active = ?"); values.push(patch.active ? 1 : 0); }
  if (fields.length === 0) return;
  await exec(`UPDATE invitee_fields SET ${fields.join(", ")} WHERE id = ?`, [...values, id]);
}

/** Custom fields can be removed outright (their values just become inert inside invitees.custom_fields).
 * Core fields can only be deactivated, never deleted. */
export async function deleteInviteeField(id: string) {
  const field = await getInviteeField(id);
  if (!field || field.kind === "core") return;
  await exec("DELETE FROM invitee_fields WHERE id = ?", [id]);
}

export async function reorderInviteeFields(eventId: string, orderedIds: string[]) {
  for (let idx = 0; idx < orderedIds.length; idx++) {
    await exec("UPDATE invitee_fields SET order_index = ? WHERE id = ? AND event_id = ?", [idx, orderedIds[idx], eventId]);
  }
}
