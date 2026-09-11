import { getDb } from "@/lib/db";
import { newId } from "@/lib/utils";

export type CommType = "invitation" | "reminder" | "event_update" | "confirmation" | "final_reminder" | "cancellation" | "custom";

export function logCommunication(input: {
  eventId: string;
  type: CommType;
  subject: string;
  body: string;
  recipientsFilter: string;
  recipientCount: number;
  sentBy: string;
}) {
  const db = getDb();
  const id = newId("com");
  db.prepare(
    `INSERT INTO communications (id, event_id, type, subject, body, recipients_filter, recipient_count, sent_by)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(id, input.eventId, input.type, input.subject, input.body, input.recipientsFilter, input.recipientCount, input.sentBy);
  return id;
}

export function listCommunications(eventId: string) {
  const db = getDb();
  return db.prepare("SELECT * FROM communications WHERE event_id = ? ORDER BY created_at DESC").all(eventId);
}
