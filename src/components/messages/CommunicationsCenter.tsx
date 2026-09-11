"use client";

import { useEffect, useState } from "react";

interface Group { id: string; name: string; }
interface Comm { id: string; type: string; subject: string; recipients_filter: string; recipient_count: number; created_at: string; }

const TYPES = [
  { value: "invitation", label: "Invitation", subject: "You're invited!", body: "We'd love to have you join us — please RSVP when you get a chance." },
  { value: "reminder", label: "Reminder", subject: "Reminder: please RSVP", body: "Just a friendly reminder to let us know if you can make it." },
  { value: "event_update", label: "Event update", subject: "Event details have changed", body: "We wanted to make sure you had the latest details." },
  { value: "final_reminder", label: "Final reminder", subject: "Last chance to RSVP", body: "RSVPs are closing soon — please respond if you haven't already." },
  { value: "custom", label: "Custom message", subject: "", body: "" },
];

const AUDIENCES = [
  { value: "everyone", label: "Everyone" },
  { value: "attending", label: "Attending" },
  { value: "declined", label: "Declined" },
  { value: "no_response", label: "No response yet" },
  { value: "adults", label: "Adults" },
  { value: "children", label: "Children" },
];

export function CommunicationsCenter({ eventId, groups }: { eventId: string; groups: Group[] }) {
  const [history, setHistory] = useState<Comm[]>([]);
  const [type, setType] = useState("reminder");
  const [subject, setSubject] = useState(TYPES[1].subject);
  const [message, setMessage] = useState(TYPES[1].body);
  const [audience, setAudience] = useState("no_response");
  const [groupId, setGroupId] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadHistory() {
    const res = await fetch(`/api/events/${eventId}/communications`);
    const data = await res.json();
    setHistory(data.communications || []);
  }

  useEffect(() => {
    loadHistory();
  }, [eventId]);

  function onTypeChange(t: string) {
    setType(t);
    const preset = TYPES.find((p) => p.value === t)!;
    setSubject(preset.subject);
    setMessage(preset.body);
    if (t === "invitation") setAudience("everyone");
    if (t === "reminder" || t === "final_reminder") setAudience("no_response");
  }

  async function send() {
    setError(null);
    setResult(null);
    if (!subject.trim() || !message.trim()) {
      setError("Add a subject and message.");
      return;
    }
    setSending(true);
    const res = await fetch(`/api/events/${eventId}/communications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, subject, message, audience: audience === "group" ? "group" : audience, groupId: audience === "group" ? groupId : undefined }),
    });
    const data = await res.json();
    setSending(false);
    if (!res.ok) {
      setError(data.error || "Something went wrong.");
      return;
    }
    setResult(`Sent to ${data.sent} recipient${data.sent === 1 ? "" : "s"}.`);
    loadHistory();
  }

  return (
    <div className="p-8 grid lg:grid-cols-[1fr_360px] gap-8 max-w-5xl">
      <div>
        <h2 className="font-serif text-xl text-ink">Send a message</h2>
        <p className="mt-1 text-sm text-ink-soft">Emails go to whichever invitees have an email address on file.</p>

        <div className="mt-5 card p-6 space-y-4">
          {error && <div className="rounded border border-clay-500/30 bg-clay-500/5 text-clay-600 text-sm px-3 py-2.5">{error}</div>}
          {result && <div className="rounded border border-moss-400/30 bg-moss-50 text-moss-600 text-sm px-3 py-2.5">{result}</div>}

          <div>
            <label className="label">Message type</label>
            <select className="input" value={type} onChange={(e) => onTypeChange(e.target.value)}>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Send to</label>
            <div className="flex gap-2 flex-wrap">
              {AUDIENCES.map((a) => (
                <button
                  type="button"
                  key={a.value}
                  onClick={() => setAudience(a.value)}
                  className={`chip border ${audience === a.value ? "bg-wine-500 text-paper border-wine-500" : "border-paper-line text-ink-soft"}`}
                >
                  {a.label}
                </button>
              ))}
              {groups.length > 0 && (
                <button
                  type="button"
                  onClick={() => setAudience("group")}
                  className={`chip border ${audience === "group" ? "bg-wine-500 text-paper border-wine-500" : "border-paper-line text-ink-soft"}`}
                >
                  Specific group
                </button>
              )}
            </div>
            {audience === "group" && (
              <select className="input mt-2" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">Choose a group…</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            )}
          </div>
          <div>
            <label className="label">Subject</label>
            <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <label className="label">Message</label>
            <textarea className="input min-h-[140px]" value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
          <div className="flex justify-end">
            <button onClick={send} disabled={sending} className="btn-primary">{sending ? "Sending…" : "Send message"}</button>
          </div>
        </div>
      </div>

      <div>
        <h2 className="font-serif text-lg text-ink">History</h2>
        <div className="mt-4 space-y-2.5">
          {history.length === 0 ? (
            <p className="text-sm text-ink-faint">Nothing sent yet.</p>
          ) : (
            history.map((c) => (
              <div key={c.id} className="card p-4">
                <p className="text-sm text-ink">{c.subject}</p>
                <p className="mt-1 text-xs text-ink-faint">
                  {c.recipient_count} recipient{c.recipient_count === 1 ? "" : "s"} · {new Date(c.created_at).toLocaleString()}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
