import { getDb } from "@/lib/db";
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

export function listQuestions(eventId: string): QuestionRow[] {
  const db = getDb();
  return db.prepare("SELECT * FROM rsvp_questions WHERE event_id = ? ORDER BY order_index ASC").all(eventId) as QuestionRow[];
}

export function createQuestion(eventId: string, input: {
  label: string; type: QuestionType; options?: string[]; required?: boolean; showIfAttending?: "yes" | "no" | null;
}): QuestionRow {
  const db = getDb();
  const id = newId("q");
  const maxOrder = db.prepare("SELECT COALESCE(MAX(order_index), -1) as m FROM rsvp_questions WHERE event_id = ?").get(eventId) as { m: number };
  db.prepare(
    `INSERT INTO rsvp_questions (id, event_id, label, type, options_json, required, order_index, show_if_attending)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(id, eventId, input.label, input.type, input.options ? JSON.stringify(input.options) : null, input.required ? 1 : 0, maxOrder.m + 1, input.showIfAttending || null);
  return db.prepare("SELECT * FROM rsvp_questions WHERE id = ?").get(id) as QuestionRow;
}

export function updateQuestion(id: string, patch: Partial<{ label: string; type: QuestionType; options: string[]; required: boolean; showIfAttending: "yes" | "no" | null; order_index: number }>) {
  const db = getDb();
  const fields: string[] = [];
  const values: any[] = [];
  if (patch.label !== undefined) { fields.push("label = ?"); values.push(patch.label); }
  if (patch.type !== undefined) { fields.push("type = ?"); values.push(patch.type); }
  if (patch.options !== undefined) { fields.push("options_json = ?"); values.push(JSON.stringify(patch.options)); }
  if (patch.required !== undefined) { fields.push("required = ?"); values.push(patch.required ? 1 : 0); }
  if (patch.showIfAttending !== undefined) { fields.push("show_if_attending = ?"); values.push(patch.showIfAttending); }
  if (patch.order_index !== undefined) { fields.push("order_index = ?"); values.push(patch.order_index); }
  if (fields.length === 0) return;
  db.prepare(`UPDATE rsvp_questions SET ${fields.join(", ")} WHERE id = ?`).run(...values, id);
}

export function deleteQuestion(id: string) {
  const db = getDb();
  db.prepare("DELETE FROM rsvp_questions WHERE id = ?").run(id);
}

export function reorderQuestions(eventId: string, orderedIds: string[]) {
  const db = getDb();
  const tx = db.transaction((ids: string[]) => {
    ids.forEach((id, idx) => {
      db.prepare("UPDATE rsvp_questions SET order_index = ? WHERE id = ? AND event_id = ?").run(idx, id, eventId);
    });
  });
  tx(orderedIds);
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

export function getLatestResponse(invitationId: string): ResponseRow | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM rsvp_responses WHERE invitation_id = ? ORDER BY responded_at DESC LIMIT 1")
    .get(invitationId) as ResponseRow | undefined;
}

export function getAnswersForResponse(responseId: string): { question_id: string; value: string | null }[] {
  const db = getDb();
  return db.prepare("SELECT question_id, value FROM rsvp_answers WHERE response_id = ?").all(responseId) as any;
}

export function submitResponse(input: {
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
}): ResponseRow {
  const db = getDb();
  const isModification = !!getLatestResponse(input.invitationId);
  const id = newId("resp");
  db.prepare(
    `INSERT INTO rsvp_responses (
      id, invitation_id, event_id, attending, num_attending, guest_names_json,
      responder_name, responder_email, responder_phone, is_modification, reopened_after_deadline
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, input.invitationId, input.eventId, input.attending ? 1 : 0, input.numAttending,
    input.guestNames ? JSON.stringify(input.guestNames) : null,
    input.responderName || null, input.responderEmail || null, input.responderPhone || null,
    isModification ? 1 : 0, input.reopenedAfterDeadline ? 1 : 0
  );

  const insertAnswer = db.prepare("INSERT INTO rsvp_answers (id, response_id, question_id, value) VALUES (?,?,?,?)");
  const tx = db.transaction((answers: typeof input.answers) => {
    for (const a of answers) {
      insertAnswer.run(newId("ans"), id, a.questionId, a.value);
    }
  });
  tx(input.answers);

  db.prepare("UPDATE invitations SET status = ? WHERE id = ?").run(input.attending ? "attending" : "declined", input.invitationId);

  return db.prepare("SELECT * FROM rsvp_responses WHERE id = ?").get(id) as ResponseRow;
}

export function listResponsesForEvent(eventId: string) {
  const db = getDb();
  return db
    .prepare(
      `SELECT r.*, iv.first_name, iv.last_name, iv.email as invitee_email, i.token
       FROM rsvp_responses r
       JOIN invitations i ON i.id = r.invitation_id
       LEFT JOIN invitees iv ON iv.id = i.invitee_id
       WHERE r.event_id = ? AND r.id IN (
         SELECT r2.id FROM rsvp_responses r2
         WHERE r2.invitation_id = r.invitation_id
         ORDER BY r2.responded_at DESC LIMIT 1
       )
       ORDER BY r.responded_at DESC`
    )
    .all(eventId);
}

export function questionReport(eventId: string, questionId: string): { value: string; count: number }[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT a.value, COUNT(*) as count FROM rsvp_answers a
       JOIN rsvp_responses r ON r.id = a.response_id
       WHERE a.question_id = ? AND r.event_id = ? AND r.id IN (
         SELECT r2.id FROM rsvp_responses r2 WHERE r2.invitation_id = r.invitation_id ORDER BY r2.responded_at DESC LIMIT 1
       )
       GROUP BY a.value ORDER BY count DESC`
    )
    .all(questionId, eventId) as { value: string; count: number }[];
  return rows;
}
