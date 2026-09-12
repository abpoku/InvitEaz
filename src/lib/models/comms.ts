import { query, exec } from "@/lib/db";
import { newId } from "@/lib/utils";

export type CommType = "invitation" | "reminder" | "event_update" | "confirmation" | "final_reminder" | "cancellation" | "custom";

export async function logCommunication(input: {
  eventId: string;
  type: CommType;
  subject: string;
  body: string;
  recipientsFilter: string;
  recipientCount: number;
  sentBy: string;
}) {
  const id = newId("com");
  await exec(
    `INSERT INTO communications (id, event_id, type, subject, body, recipients_filter, recipient_count, sent_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, input.eventId, input.type, input.subject, input.body, input.recipientsFilter, input.recipientCount, input.sentBy]
  );
  return id;
}

export async function listCommunications(eventId: string) {
  return query("SELECT * FROM communications WHERE event_id = ? ORDER BY created_at DESC", [eventId]);
}
