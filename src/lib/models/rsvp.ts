import { query, queryOne, exec } from "@/lib/db";
import { newId } from "@/lib/utils";

export type QuestionType =
  | "short_text" | "long_text" | "single_choice" | "multiple_choice" | "dropdown"
  | "yes_no" | "number" | "date" | "time" | "email" | "phone" | "checkbox";

export interface QuestionRow {
  id: string;
  event_id: string;
  label: string;
  type: QuestionType;
  options_json: string | null;
  required: number;
  order_index: number;
  show_if_attending: "yes" | "no" | null;
  created_at: string;
}

export async function listQuestions(eventId: string): Promise<QuestionRow[]> {
  return query<QuestionRow>("SELECT * FROM rsvp_questions WHERE event_id = ? ORDER BY order_index ASC", [eventId]);
}

export async function createQuestion(eventId: string, input: {
  label: string; type: QuestionType; options?: string[]; required?: boolean; showIfAttending?: "yes" | "no" | null;
}): Promise<QuestionRow> {
  const id = newId("q");
  const maxOrder = await queryOne<{ m: number }>(
    "SELECT COALESCE(MAX(order_index), -1) as m FROM rsvp_questions WHERE event_id = ?",
    [eventId]
  );
  await exec(
    `INSERT INTO rsvp_questions (id, event_id, label, type, options_json, required, order_index, show_if_attending)
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, eventId, input.label, input.type, input.options ? JSON.stringify(input.options) : null, input.required ? 1 : 0, (maxOrder?.m ?? -1) + 1, input.showIfAttending || null]
  );
  return (await queryOne<QuestionRow>("SELECT * FROM rsvp_questions WHERE id = ?", [id]))!;
}

export async function updateQuestion(id: string, patch: Partial<{ label: string; type: QuestionType; options: string[]; required: boolean; showIfAttending: "yes" | "no" | null; order_index: number }>) {
  const fields: string[] = [];
  const values: any[] = [];
  if (patch.label !== undefined) { fields.push("label = ?"); values.push(patch.label); }
  if (patch.type !== undefined) { fields.push("type = ?"); values.push(patch.type); }
  if (patch.options !== undefined) { fields.push("options_json = ?"); values.push(JSON.stringify(patch.options)); }
  if (patch.required !== undefined) { fields.push("required = ?"); values.push(patch.required ? 1 : 0); }
  if (patch.showIfAttending !== undefined) { fields.push("show_if_attending = ?"); values.push(patch.showIfAttending); }
  if (patch.order_index !== undefined) { fields.push("order_index = ?"); values.push(patch.order_index); }
  if (fields.length === 0) return;
  await exec(`UPDATE rsvp_questions SET ${fields.join(", ")} WHERE id = ?`, [...values, id]);
}

export async function deleteQuestion(id: string) {
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
      responder_name, responder_email, responder_phone, is_modification, reopened_after_deadline
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, input.invitationId, input.eventId, input.attending ? 1 : 0, input.numAttending,
      input.guestNames ? JSON.stringify(input.guestNames) : null,
      input.responderName || null, input.responderEmail || null, input.responderPhone || null,
      isModification ? 1 : 0, input.reopenedAfterDeadline ? 1 : 0,
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

export async function listResponsesForEvent(eventId: string) {
  return query(
    `SELECT r.*, iv.first_name, iv.last_name, iv.email as invitee_email, i.token
     FROM rsvp_responses r
     JOIN invitations i ON i.id = r.invitation_id
     LEFT JOIN invitees iv ON iv.id = i.invitee_id
     WHERE r.event_id = ? AND r.id IN (
       SELECT r2.id FROM rsvp_responses r2
       WHERE r2.invitation_id = r.invitation_id
       ORDER BY r2.responded_at DESC LIMIT 1
     )
     ORDER BY r.responded_at DESC`,
    [eventId]
  );
}

export async function questionReport(eventId: string, questionId: string): Promise<{ value: string; count: number }[]> {
  const rows = await query<{ value: string; count: string }>(
    `SELECT a.value, COUNT(*) as count FROM rsvp_answers a
     JOIN rsvp_responses r ON r.id = a.response_id
     WHERE a.question_id = ? AND r.event_id = ? AND r.id IN (
       SELECT r2.id FROM rsvp_responses r2 WHERE r2.invitation_id = r.invitation_id ORDER BY r2.responded_at DESC LIMIT 1
     )
     GROUP BY a.value ORDER BY count DESC`,
    [questionId, eventId]
  );
  // Postgres returns COUNT(*) as a string (bigint) to avoid precision loss — convert to number.
  return rows.map((r) => ({ value: r.value, count: Number(r.count) }));
}
