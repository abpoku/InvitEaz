import { query, queryOne, exec } from "@/lib/db";
import { newId } from "@/lib/utils";
import { setInvitationStatus } from "@/lib/models/invitees";

export type QuestionType =
  | "short_text" | "long_text" | "single_choice" | "multiple_choice" | "dropdown"
  | "yes_no" | "number" | "date" | "time" | "email" | "phone" | "checkbox";

export type QuestionKind = "core" | "custom";

export interface QuestionRow {
  id: string;
  event_id: string;
  label: string;
  type: QuestionType;
  options_json: string | null;
  required: number;
  order_index: number;
  show_if_attending: "yes" | "no" | null;
  kind: QuestionKind;
  key: string | null;
  active: number;
  created_at: string;
}

/** The always-present core RSVP fields, seeded once per event on first read. Planners can reword
 * and toggle required/active on these (except `attending`, which every guest must always answer),
 * but the answer `type` stays fixed since headcount/stats/filtering depend on its exact shape.
 * "Name" isn't a row here — it's collected unconditionally and isn't configurable. */
const CORE_RSVP_QUESTION_DEFAULTS: { key: string; label: string; type: QuestionType; required: boolean }[] = [
  { key: "attending", label: "Will you be attending?", type: "yes_no", required: true },
  { key: "email", label: "Email", type: "email", required: false },
  { key: "phone", label: "Phone", type: "phone", required: false },
  { key: "guest_count", label: "How many in your party (including you)?", type: "number", required: false },
];

async function seedRsvpQuestionDefaultsIfMissing(eventId: string) {
  const existing = await queryOne<{ c: string }>("SELECT COUNT(*) as c FROM rsvp_questions WHERE event_id = ? AND kind = 'core'", [eventId]);
  if (Number(existing?.c || 0) > 0) return;
  for (let i = 0; i < CORE_RSVP_QUESTION_DEFAULTS.length; i++) {
    const q = CORE_RSVP_QUESTION_DEFAULTS[i];
    await exec(
      `INSERT INTO rsvp_questions (id, event_id, label, type, required, order_index, kind, key, active)
       VALUES (?,?,?,?,?,?,'core',?,1)
       ON CONFLICT (event_id, key) WHERE key IS NOT NULL DO NOTHING`,
      [newId("q"), eventId, q.label, q.type, q.required ? 1 : 0, i, q.key]
    );
  }
}

export async function listQuestions(eventId: string): Promise<QuestionRow[]> {
  await seedRsvpQuestionDefaultsIfMissing(eventId);
  return query<QuestionRow>("SELECT * FROM rsvp_questions WHERE event_id = ? ORDER BY order_index ASC", [eventId]);
}

export async function getQuestion(id: string): Promise<QuestionRow | undefined> {
  return queryOne<QuestionRow>("SELECT * FROM rsvp_questions WHERE id = ?", [id]);
}

export async function createQuestion(eventId: string, input: {
  label: string; type: QuestionType; options?: string[]; required?: boolean; showIfAttending?: "yes" | "no" | null;
}): Promise<QuestionRow> {
  await seedRsvpQuestionDefaultsIfMissing(eventId);
  const id = newId("q");
  const maxOrder = await queryOne<{ m: number }>(
    "SELECT COALESCE(MAX(order_index), -1) as m FROM rsvp_questions WHERE event_id = ?",
    [eventId]
  );
  await exec(
    `INSERT INTO rsvp_questions (id, event_id, label, type, options_json, required, order_index, show_if_attending, kind)
     VALUES (?,?,?,?,?,?,?,?,'custom')`,
    [id, eventId, input.label, input.type, input.options ? JSON.stringify(input.options) : null, input.required ? 1 : 0, (maxOrder?.m ?? -1) + 1, input.showIfAttending || null]
  );
  return (await queryOne<QuestionRow>("SELECT * FROM rsvp_questions WHERE id = ?", [id]))!;
}

/** Core rows may only have label/required/active/order_index changed — their type/key stay fixed
 * since the guest-facing form and rsvp_responses' dedicated columns depend on them. `attending`
 * additionally can't have required/active changed at all: every guest must always answer it.
 * (This diverges from invitee_fields' core guard, which locks label too — here the whole point is
 * letting planners reword the built-in questions, just not change their answer type.) */
export async function updateQuestion(id: string, patch: Partial<{ label: string; type: QuestionType; options: string[]; required: boolean; showIfAttending: "yes" | "no" | null; order_index: number; active: boolean }>) {
  const question = await getQuestion(id);
  if (!question) return;
  const isCore = question.kind === "core";
  const isAttending = isCore && question.key === "attending";

  const fields: string[] = [];
  const values: any[] = [];
  if (patch.label !== undefined) { fields.push("label = ?"); values.push(patch.label); }
  if (!isCore && patch.type !== undefined) { fields.push("type = ?"); values.push(patch.type); }
  if (!isCore && patch.options !== undefined) { fields.push("options_json = ?"); values.push(JSON.stringify(patch.options)); }
  if (patch.required !== undefined && !isAttending) { fields.push("required = ?"); values.push(patch.required ? 1 : 0); }
  if (!isCore && patch.showIfAttending !== undefined) { fields.push("show_if_attending = ?"); values.push(patch.showIfAttending); }
  if (patch.order_index !== undefined) { fields.push("order_index = ?"); values.push(patch.order_index); }
  if (patch.active !== undefined && !isAttending) { fields.push("active = ?"); values.push(patch.active ? 1 : 0); }
  if (fields.length === 0) return;
  await exec(`UPDATE rsvp_questions SET ${fields.join(", ")} WHERE id = ?`, [...values, id]);
}

/** Custom questions can be removed outright. Core questions can only be deactivated (except
 * `attending`, which can't even be deactivated), never deleted. */
export async function deleteQuestion(id: string) {
  const question = await getQuestion(id);
  if (!question || question.kind === "core") return;
  await exec("DELETE FROM rsvp_questions WHERE id = ?", [id]);
}

export async function reorderQuestions(eventId: string, orderedIds: string[]) {
  for (let idx = 0; idx < orderedIds.length; idx++) {
    await exec("UPDATE rsvp_questions SET order_index = ? WHERE id = ? AND event_id = ?", [idx, orderedIds[idx], eventId]);
  }
}

export interface ResponseRow {
  id: string;
  invitation_id: string;
  event_id: string;
  attending: number;
  num_attending: number;
  guest_names_json: string | null;
  responder_name: string | null;
  responder_email: string | null;
  responder_phone: string | null;
  is_modification: number;
  reopened_after_deadline: number;
  responded_at: string;
  rsvp_status: "attending" | "declined" | "maybe";
  recorded_by: string | null;
}

export async function getLatestResponse(invitationId: string): Promise<ResponseRow | undefined> {
  return queryOne<ResponseRow>(
    "SELECT * FROM rsvp_responses WHERE invitation_id = ? ORDER BY responded_at DESC LIMIT 1",
    [invitationId]
  );
}

export async function getAnswersForResponse(responseId: string): Promise<{ question_id: string; value: string | null }[]> {
  return query("SELECT question_id, value FROM rsvp_answers WHERE response_id = ?", [responseId]);
}

export async function submitResponse(input: {
  invitationId: string;
  eventId: string;
  attending: boolean;
  numAttending: number;
  guestNames?: string[];
  responderName?: string;
  responderEmail?: string;
  responderPhone?: string;
  answers: { questionId: string; value: string }[];
  reopenedAfterDeadline?: boolean;
}): Promise<ResponseRow> {
  const isModification = !!(await getLatestResponse(input.invitationId));
  const id = newId("resp");
  await exec(
    `INSERT INTO rsvp_responses (
      id, invitation_id, event_id, attending, num_attending, guest_names_json,
      responder_name, responder_email, responder_phone, is_modification, reopened_after_deadline,
      rsvp_status, recorded_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, input.invitationId, input.eventId, input.attending ? 1 : 0, input.numAttending,
      input.guestNames ? JSON.stringify(input.guestNames) : null,
      input.responderName || null, input.responderEmail || null, input.responderPhone || null,
      isModification ? 1 : 0, input.reopenedAfterDeadline ? 1 : 0,
      input.attending ? "attending" : "declined", null,
    ]
  );

  for (const a of input.answers) {
    await exec(
      "INSERT INTO rsvp_answers (id, response_id, question_id, value) VALUES (?,?,?,?)",
      [newId("ans"), id, a.questionId, a.value]
    );
  }

  await exec("UPDATE invitations SET status = ? WHERE id = ?", [input.attending ? "attending" : "declined", input.invitationId]);

  return (await queryOne<ResponseRow>("SELECT * FROM rsvp_responses WHERE id = ?", [id]))!;
}

/** The planner-entry path — records a status on an invitee's behalf (e.g. they called in). Unlike
 * submitResponse, this deliberately doesn't collect answers/guest-names/responder-contact info —
 * just a status and an optional party size. Always inserts a new row (never updates in place), so
 * a guest who later submits themselves via their own link automatically supersedes this: their
 * row just becomes the new latest by responded_at, with no special-casing needed anywhere. */
export async function recordManualResponse(input: {
  invitationId: string;
  eventId: string;
  status: "attending" | "declined" | "maybe";
  numAttending?: number;
  recordedBy: string;
}): Promise<ResponseRow> {
  const isModification = !!(await getLatestResponse(input.invitationId));
  const id = newId("resp");
  const attending = input.status === "attending" ? 1 : 0;
  const numAttending = input.status === "attending" ? Math.max(1, input.numAttending || 1) : 0;
  await exec(
    `INSERT INTO rsvp_responses (id, invitation_id, event_id, attending, num_attending, is_modification, rsvp_status, recorded_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, input.invitationId, input.eventId, attending, numAttending, isModification ? 1 : 0, input.status, input.recordedBy]
  );
  await setInvitationStatus(input.invitationId, input.status);
  return (await queryOne<ResponseRow>("SELECT * FROM rsvp_responses WHERE id = ?", [id]))!;
}

export async function listResponsesForEvent(eventId: string, assemblyId?: string | null) {
  return query(
    `SELECT r.*, iv.first_name, iv.last_name, iv.email as invitee_email, iv.assembly_id, i.token
     FROM rsvp_responses r
     JOIN invitations i ON i.id = r.invitation_id
     LEFT JOIN invitees iv ON iv.id = i.invitee_id
     WHERE r.event_id = ? AND r.id IN (
       SELECT r2.id FROM rsvp_responses r2
       WHERE r2.invitation_id = r.invitation_id
       ORDER BY r2.responded_at DESC LIMIT 1
     )
     ${assemblyId ? "AND iv.assembly_id = ?" : ""}
     ORDER BY r.responded_at DESC`,
    assemblyId ? [eventId, assemblyId] : [eventId]
  );
}

export interface InviteeResponseRow {
  invitee_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  assembly_id: string | null;
  assembly_name: string | null;
  group_id: string | null;
  group_name: string | null;
  custom_fields: string | null;
  invitation_id: string | null;
  invitation_status: string | null;
  token: string | null;
  response_id: string | null;
  rsvp_status: "attending" | "declined" | "maybe" | null;
  num_attending: number | null;
  responded_at: string | null;
  is_modification: number | null;
  recorded_by: string | null;
}

/** Powers the Responses tab: every invitee for the event (unlike listResponsesForEvent, which
 * only returns invitations that already have a response), each with their invitation and latest
 * response detail joined in, so planners can see and set a status for people who've never
 * responded at all. group_id/custom_fields ride along for the ticketing feature's price
 * calculation (src/lib/models/ticketing.ts) — this query stays ticketing-agnostic otherwise. */
export async function listInviteeResponseRows(eventId: string, assemblyId?: string | null): Promise<InviteeResponseRow[]> {
  return query<InviteeResponseRow>(
    `SELECT iv.id as invitee_id, iv.first_name, iv.last_name, iv.email, iv.assembly_id,
       a.name as assembly_name, iv.group_id, g.name as group_name, iv.custom_fields,
       i.id as invitation_id, i.status as invitation_status, i.token,
       r.id as response_id, r.rsvp_status, r.num_attending, r.responded_at, r.is_modification, r.recorded_by
     FROM invitees iv
     LEFT JOIN invitations i ON i.invitee_id = iv.id
     LEFT JOIN assemblies a ON a.id = iv.assembly_id
     LEFT JOIN groups g ON g.id = iv.group_id
     LEFT JOIN rsvp_responses r ON r.id = (
       SELECT r2.id FROM rsvp_responses r2 WHERE r2.invitation_id = i.id ORDER BY r2.responded_at DESC LIMIT 1
     )
     WHERE iv.event_id = ? AND iv.active = 1
     ${assemblyId ? "AND iv.assembly_id = ?" : ""}
     ORDER BY iv.created_at ASC`,
    assemblyId ? [eventId, assemblyId] : [eventId]
  );
}

export async function questionReport(eventId: string, questionId: string, assemblyId?: string | null): Promise<{ value: string; count: number }[]> {
  const rows = await query<{ value: string; count: string }>(
    `SELECT a.value, COUNT(*) as count FROM rsvp_answers a
     JOIN rsvp_responses r ON r.id = a.response_id
     JOIN invitations i ON i.id = r.invitation_id
     LEFT JOIN invitees iv ON iv.id = i.invitee_id
     WHERE a.question_id = ? AND r.event_id = ? AND r.id IN (
       SELECT r2.id FROM rsvp_responses r2 WHERE r2.invitation_id = r.invitation_id ORDER BY r2.responded_at DESC LIMIT 1
     )
     ${assemblyId ? "AND iv.assembly_id = ?" : ""}
     GROUP BY a.value ORDER BY count DESC`,
    assemblyId ? [questionId, eventId, assemblyId] : [questionId, eventId]
  );
  // Postgres returns COUNT(*) as a string (bigint) to avoid precision loss — convert to number.
  return rows.map((r) => ({ value: r.value, count: Number(r.count) }));
}
