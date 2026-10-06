"use client";

import { useCallback, useEffect, useState } from "react";
import { PhoneTextSender, type PhoneRecipient } from "@/components/messages/PhoneTextSender";
import { PHONE_TEMPLATES, personalize } from "@/lib/phone-text";

interface Group { id: string; name: string; }
interface Assembly { id: string; name: string; }
interface Comm {
  id: string; type: string; channel: "email" | "sms" | "phone"; subject: string; recipients_filter: string;
  recipient_count: number; failed_count?: number; created_at: string;
}
type Channel = "email" | "phone" | "sms";

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
  { value: "maybe", label: "Maybe" },
  { value: "declined", label: "Declined" },
  { value: "no_response", label: "No response yet" },
  { value: "adults", label: "Adults" },
  { value: "children", label: "Children" },
];

const CHANNEL_LABEL: Record<Comm["channel"], string> = { email: "Email", sms: "Text", phone: "From my phone" };

/** What a message box should hold for this type + channel. Phone texts get short, link-carrying
 * templates; emails keep their longer copy (the RSVP button is added to every email anyway). */
function presetBody(type: string, channel: Channel) {
  if (channel === "phone") return PHONE_TEMPLATES[type] ?? "";
  return TYPES.find((t) => t.value === type)?.body ?? "";
}
const isPreset = (text: string) =>
  !text.trim() || TYPES.some((t) => t.body === text) || Object.values(PHONE_TEMPLATES).includes(text);

async function postJson(url: string, body: unknown, init?: RequestInit): Promise<{ ok: boolean; data: any }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...init });
    let data: any = {};
    try { data = await res.json(); } catch {}
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: { error: "We couldn't reach the server just now. Please try again." } };
  }
}

export function CommunicationsCenter({
  eventId, eventName, groups, assemblies, twilioConfigured,
}: {
  eventId: string;
  eventName: string;
  groups: Group[];
  assemblies: Assembly[];
  twilioConfigured: boolean;
}) {
  const [history, setHistory] = useState<Comm[]>([]);
  const [channel, setChannel] = useState<Channel>("email");
  const [type, setType] = useState("reminder");
  const [subject, setSubject] = useState(TYPES[1].subject);
  const [message, setMessage] = useState(TYPES[1].body);
  const [audience, setAudience] = useState("no_response");
  const [groupId, setGroupId] = useState("");
  const [assemblyId, setAssemblyId] = useState("");
  const [perHousehold, setPerHousehold] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ count: number; withoutContact: number } | null>(null);
  const [phone, setPhone] = useState<{ recipients: PhoneRecipient[]; skipped: { name: string; reason: string }[] } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadHistory() {
    try {
      const res = await fetch(`/api/events/${eventId}/communications`);
      let data: any = {};
      try { data = await res.json(); } catch {}
      if (res.ok) setHistory(data.communications || []);
    } catch {}
  }

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const audienceBody = () => ({
    type, audience,
    groupId: audience === "group" ? groupId : undefined,
    assemblyId: audience === "assembly" ? assemblyId : undefined,
  });

  function reset() { setError(null); setResult(null); setConfirm(null); }

  function onTypeChange(t: string) {
    setType(t);
    const preset = TYPES.find((p) => p.value === t)!;
    setSubject(preset.subject);
    setMessage(presetBody(t, channel));
    if (t === "invitation") setAudience("everyone");
    if (t === "reminder" || t === "final_reminder") setAudience("no_response");
    reset();
  }

  function onChannelChange(c: Channel) {
    setChannel(c);
    if (isPreset(message)) setMessage(presetBody(type, c));
    reset();
  }

  function validate(): boolean {
    if (audience === "group" && !groupId) { setError("Choose a group to message."); return false; }
    if (audience === "assembly" && !assemblyId) { setError("Choose a clone to message."); return false; }
    if (!message.trim() && channel !== "phone") { setError("Add a message."); return false; }
    if (channel === "email" && !subject.trim()) { setError("Add a subject."); return false; }
    return true;
  }

  // Email / automated text: preview first, then the planner confirms the exact number.
  async function preview() {
    reset();
    if (!validate()) return;
    setBusy(true);
    const { ok, data } = await postJson(`/api/events/${eventId}/communications`, { ...audienceBody(), channel, action: "preview" });
    setBusy(false);
    if (!ok) return setError(data.error || "Something went wrong.");
    if (data.count === 0) return setError(`No one in this audience has ${channel === "email" ? "an email address" : "a phone number"} on file.`);
    setConfirm(data);
  }

  async function send() {
    setError(null);
    setBusy(true);
    const { ok, data } = await postJson(`/api/events/${eventId}/communications`, { ...audienceBody(), channel, subject, message, action: "send" });
    setBusy(false);
    setConfirm(null);
    if (!ok) return setError(data.error || "Something went wrong.");
    const noun = channel === "email" ? "email" : "text";
    setResult(
      `Sent ${data.sent} ${noun}${data.sent === 1 ? "" : "s"}.` +
      (data.failed ? ` ${data.failed} couldn't be delivered — check those addresses and try again.` : "")
    );
    loadHistory();
  }

  async function preparePhone() {
    reset();
    if (!validate()) return;
    setBusy(true);
    const { ok, data } = await postJson(`/api/events/${eventId}/communications`, { ...audienceBody(), perHousehold, action: "phone_prepare" });
    setBusy(false);
    if (!ok) return setError(data.error || "Something went wrong.");
    setPhone({ recipients: data.recipients || [], skipped: data.skipped || [] });
  }

  const logPhone = useCallback(async (opened: number) => {
    await postJson(
      `/api/events/${eventId}/communications`,
      { type, audience, groupId: audience === "group" ? groupId : undefined, assemblyId: audience === "assembly" ? assemblyId : undefined, message, perHousehold, opened, action: "phone_log" },
      { keepalive: true }
    );
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, type, audience, groupId, assemblyId, message, perHousehold]);

  const sample = personalize(message, { firstName: "Maria", name: perHousehold ? "Johnson Family" : "Maria Johnson", event: eventName, link: "https://…/r/abc123" });
  const chip = (active: boolean) => `chip border ${active ? "bg-wine-500 text-paper border-wine-500" : "border-paper-line text-ink-soft"}`;

  return (
    <div className="p-4 sm:p-8 grid lg:grid-cols-[1fr_360px] gap-6 sm:gap-8 max-w-5xl">
      <div>
        <h2 className="font-serif text-xl text-ink">Send a message</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {channel === "email"
            ? "Emails go to whichever invitees have an email address on file."
            : channel === "phone"
              ? "Texts open in your own Messages app, one person at a time — they come from your number, and replies come to your phone."
              : "Automated texts go to whichever invitees have a phone number on file."}
        </p>

        {phone ? (
          <div className="mt-5">
            <PhoneTextSender
              recipients={phone.recipients}
              skipped={phone.skipped}
              template={message}
              eventName={eventName}
              onLog={logPhone}
              onClose={() => { setPhone(null); loadHistory(); }}
            />
          </div>
        ) : (
          <div className="mt-5 card p-6 space-y-4">
            {error && <div className="rounded border border-clay-500/30 bg-clay-500/5 text-clay-600 text-sm px-3 py-2.5">{error}</div>}
            {result && <div className="rounded border border-moss-400/30 bg-moss-50 text-moss-600 text-sm px-3 py-2.5">{result}</div>}

            <div>
              <label className="label">Channel</label>
              <div className="flex gap-2 flex-wrap">
                <button type="button" onClick={() => onChannelChange("email")} className={chip(channel === "email")}>Email</button>
                <button type="button" onClick={() => onChannelChange("phone")} className={chip(channel === "phone")}>Text from my phone</button>
                {twilioConfigured && (
                  <button type="button" onClick={() => onChannelChange("sms")} className={chip(channel === "sms")}>Automated text</button>
                )}
              </div>
            </div>

            <div>
              <label className="label" htmlFor="msg-type">Message type</label>
              <select id="msg-type" className="input" value={type} onChange={(e) => onTypeChange(e.target.value)}>
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            <div>
              <label className="label">Send to</label>
              <div className="flex gap-2 flex-wrap">
                {AUDIENCES.map((a) => (
                  <button type="button" key={a.value} onClick={() => { setAudience(a.value); reset(); }} className={chip(audience === a.value)}>{a.label}</button>
                ))}
                {groups.length > 0 && (
                  <button type="button" onClick={() => { setAudience("group"); reset(); }} className={chip(audience === "group")}>Specific group</button>
                )}
                {assemblies.length > 0 && (
                  <button type="button" onClick={() => { setAudience("assembly"); reset(); }} className={chip(audience === "assembly")}>Specific clone</button>
                )}
              </div>
              {audience === "group" && (
                <select className="input mt-2" aria-label="Group" value={groupId} onChange={(e) => { setGroupId(e.target.value); reset(); }}>
                  <option value="">Choose a group…</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              )}
              {audience === "assembly" && (
                <select className="input mt-2" aria-label="Clone" value={assemblyId} onChange={(e) => { setAssemblyId(e.target.value); reset(); }}>
                  <option value="">Choose a clone…</option>
                  {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              )}
            </div>

            {channel === "email" && (
              <div>
                <label className="label" htmlFor="msg-subject">Subject</label>
                <input id="msg-subject" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
            )}

            <div>
              <label className="label" htmlFor="msg-body">Message</label>
              <textarea id="msg-body" className="input min-h-[140px]" value={message} onChange={(e) => setMessage(e.target.value)} />
              {channel === "phone" && (
                <p className="mt-1 text-xs text-ink-faint">
                  Use <code>{"{first_name}"}</code>, <code>{"{event}"}</code>, and <code>{"{link}"}</code> — each person gets their own. If you leave out{" "}
                  <code>{"{link}"}</code>, their RSVP link is added at the end.
                </p>
              )}
            </div>

            {channel === "phone" && (
              <>
                {groups.length > 0 && (
                  <label className="flex items-start gap-2.5 text-sm text-ink">
                    <input type="checkbox" className="mt-0.5" checked={perHousehold} onChange={(e) => setPerHousehold(e.target.checked)} />
                    <span>
                      One text per household
                      <span className="block text-xs text-ink-faint">
                        Sends each group its group link (to the group leader, or the first member with a phone). People not in a group still get their own.
                      </span>
                    </span>
                  </label>
                )}
                <div>
                  <p className="label">Preview</p>
                  <p className="rounded border border-paper-line bg-paper-soft/50 px-3 py-2 text-sm text-ink-soft whitespace-pre-line">{sample}</p>
                </div>
              </>
            )}

            {confirm ? (
              <div className="rounded border border-wine-200 bg-wine-50 px-4 py-3 text-sm">
                <p className="text-wine-700">
                  This will {channel === "email" ? "email" : "text"} <strong>{confirm.count}</strong> {confirm.count === 1 ? "person" : "people"}.
                  {confirm.withoutContact > 0 && ` ${confirm.withoutContact} in this audience ${confirm.withoutContact === 1 ? "has" : "have"} no ${channel === "email" ? "email address" : "phone number"} and will be skipped.`}
                </p>
                <div className="mt-3 flex gap-2 justify-end">
                  <button onClick={() => setConfirm(null)} className="btn-ghost" disabled={busy}>Cancel</button>
                  <button onClick={send} className="btn-primary" disabled={busy}>{busy ? "Sending…" : `Send to ${confirm.count}`}</button>
                </div>
              </div>
            ) : (
              <div className="flex justify-end">
                {channel === "phone" ? (
                  <button onClick={preparePhone} disabled={busy} className="btn-primary">{busy ? "Preparing…" : "Prepare texts"}</button>
                ) : (
                  <button onClick={preview} disabled={busy} className="btn-primary">{busy ? "Checking…" : "Review & send"}</button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <h2 className="font-serif text-lg text-ink">History</h2>
        <div className="mt-4 space-y-2.5">
          {history.length === 0 ? (
            <p className="text-sm text-ink-faint">Nothing sent yet.</p>
          ) : (
            history.map((c) => (
              <div key={c.id} className="card p-4">
                <div className="flex items-center gap-2">
                  <span className="chip bg-ink/[0.06] text-[10px] shrink-0">{CHANNEL_LABEL[c.channel] || c.channel}</span>
                  <p className="text-sm text-ink truncate">{c.subject}</p>
                </div>
                <p className="mt-1 text-xs text-ink-faint">
                  {c.channel === "phone"
                    ? `${c.recipient_count} text${c.recipient_count === 1 ? "" : "s"} opened on your phone`
                    : `${c.recipient_count} recipient${c.recipient_count === 1 ? "" : "s"}`}
                  {c.failed_count ? ` · ${c.failed_count} failed` : ""} · {new Date(c.created_at).toLocaleString()}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
