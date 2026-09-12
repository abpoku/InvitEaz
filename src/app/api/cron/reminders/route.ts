import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { computeEffectiveStatus, type EventRow, logAudit } from "@/lib/models/events";
import { listInvitees } from "@/lib/models/invitees";
import { sendReminderEmail } from "@/lib/notify";

// Sends "7 days before deadline" and "24 hours before deadline" reminders to
// invitees who haven't responded yet. Call this once a day from an external
// scheduler and protect it with CRON_SECRET (see README).
export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.get("x-cron-secret") || new URL(req.url).searchParams.get("secret");
    if (header !== secret) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const events = await query<EventRow>("SELECT * FROM events WHERE status = 'published'");

  let remindersSent = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const event of events) {
    if (computeEffectiveStatus(event) !== "published" || !event.rsvp_deadline) continue;
    const hoursUntilDeadline = (new Date(event.rsvp_deadline).getTime() - Date.now()) / 36e5;
    if (hoursUntilDeadline <= 0) continue;

    const isFinalWindow = hoursUntilDeadline <= 24;
    const isFirstWindow = hoursUntilDeadline <= 168 && hoursUntilDeadline > 144; // ~7 days, one-day catch window
    if (!isFinalWindow && !isFirstWindow) continue;

    const marker = `reminder.${isFinalWindow ? "final" : "first"}.${today}`;
    const already = await queryOne("SELECT id FROM audit_logs WHERE event_id = ? AND action = ?", [event.id, marker]);
    if (already) continue;

    const allInvitees = await listInvitees(event.id);
    const invitees = allInvitees.filter((i) => i.email && !["attending", "declined"].includes(i.status));
    for (const inv of invitees) {
      await sendReminderEmail(event, inv.email!, inv.first_name, inv.token, isFinalWindow).catch(() => {});
      remindersSent += 1;
    }
    await logAudit(event.id, "system", marker, `${invitees.length} reminder(s) sent`);
  }

  return NextResponse.json({ ok: true, remindersSent });
}
