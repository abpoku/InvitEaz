"use client";

import { useEffect, useState } from "react";
import { EnvelopeMark } from "@/components/EnvelopeMark";
import { formatDate, formatTime } from "@/lib/utils";

interface Question {
  id: string; label: string; type: string; options_json: string | null; required: number; show_if_attending: "yes" | "no" | null;
}
interface GroupMember { id: string; first_name: string; last_name: string; }
interface Data {
  event: any;
  invitee: { id: string; first_name: string; last_name: string; email: string | null; phone: string | null; plus_one_policy: string | null; group_id: string | null } | null;
  questions: Question[];
  groupMembers: GroupMember[];
  existingResponse: any | null;
  locked: boolean;
}

export function RsvpExperience({ token }: { token: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  async function load() {
    setError(null);
    const res = await fetch(`/api/rsvp/${token}`);
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "This invitation link isn't valid.");
      return;
    }
    setData(json);
  }

  useEffect(() => {
    load();
  }, [token]);

  if (error) return <MessageScreen title="Link not found" body={error} />;
  if (!data) return <MessageScreen title="Loading your invitation…" body="" loading />;

  const { event } = data;

  if (event.status === "cancelled") {
    return (
      <MessageScreen
        title="This event has been cancelled"
        body={event.cancellation_message || "The organizer has cancelled this event."}
        eventName={event.name}
      />
    );
  }

  if (data.existingResponse && !editing) {
    return <Confirmation data={data} onEdit={() => setEditing(true)} />;
  }

  if (data.locked) {
    return (
      <MessageScreen
        title="RSVPs are closed"
        body="The RSVP deadline for this event has passed. If you believe this is a mistake, please contact the organizer."
        eventName={event.name}
      />
    );
  }

  return <RsvpForm data={data} token={token} onSubmitted={() => { setEditing(false); load(); }} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper flex flex-col items-center px-4 py-10 sm:py-16">
      <EnvelopeMark className="w-9 h-6" />
      <div className="mt-8 w-full max-w-lg">{children}</div>
    </div>
  );
}

function MessageScreen({ title, body, eventName, loading }: { title: string; body: string; eventName?: string; loading?: boolean }) {
  return (
    <Shell>
      <div className="card p-8 text-center">
        {eventName && <p className="text-xs text-ink-faint mb-2">{eventName}</p>}
        <p className="font-serif text-xl text-ink">{title}</p>
        {body && <p className="mt-2.5 text-sm text-ink-soft leading-relaxed">{body}</p>}
        {loading && <div className="mt-4 mx-auto w-6 h-6 border-2 border-wine-300 border-t-wine-500 rounded-full animate-spin" />}
      </div>
    </Shell>
  );
}

function EventHeader({ event }: { event: any }) {
  const where =
    event.location_type === "virtual"
      ? "Virtual event — link provided after you RSVP"
      : [event.venue_name, event.address, event.city, event.state].filter(Boolean).join(", ") || "Location to be announced";

  return (
    <div className="card p-6">
      <p className="text-xs text-ink-faint">{formatDate(event.event_date)}</p>
      <h1 className="mt-1 font-serif text-2xl text-ink leading-tight">{event.name}</h1>
      <p className="mt-2 text-sm text-ink-soft">{formatTime(event.event_time)}{event.end_time ? ` – ${formatTime(event.end_time)}` : ""}</p>
      <p className="text-sm text-ink-soft">{where}</p>
      {event.description && <p className="mt-3 text-sm text-ink-soft leading-relaxed">{event.description}</p>}
      {event.dress_code && <p className="mt-2 text-xs text-ink-faint">Dress code: {event.dress_code}</p>}
      {event.rsvp_deadline && (
        <p className="mt-3 text-xs text-brass-600">Please respond by {new Date(event.rsvp_deadline).toLocaleString()}</p>
      )}
    </div>
  );
}

function Confirmation({ data, onEdit }: { data: Data; onEdit: () => void }) {
  const { event, existingResponse, invitee } = data;
  const attending = !!existingResponse.attending;
  return (
    <Shell>
      <EventHeader event={event} />
      <div className="card p-6 mt-4 text-center">
        <p className="font-serif text-xl text-ink">{attending ? "You're confirmed!" : "Thanks for letting us know"}</p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <span className={`chip ${attending ? "bg-moss-50 text-moss-600" : "bg-clay-500/10 text-clay-600"}`}>
            {attending ? "Attending" : "Not attending"}
          </span>
          {attending && <span className="text-sm text-ink-faint">{existingResponse.num_attending} attending</span>}
        </div>
        {event.instructions && <p className="mt-4 text-sm text-ink-soft">{event.instructions}</p>}
        {!data.locked && (
          <button onClick={onEdit} className="btn-secondary mt-6">Change your response</button>
        )}
        {data.locked && <p className="mt-4 text-xs text-ink-faint">RSVPs are closed — this is your final response.</p>}
      </div>
    </Shell>
  );
}

function RsvpForm({ data, token, onSubmitted }: { data: Data; token: string; onSubmitted: () => void }) {
  const { event, invitee, questions, groupMembers, existingResponse } = data;
  const isGroupMode = event.group_rsvp_mode !== "individual" && groupMembers.length > 0;
  const policy = invitee?.plus_one_policy || event.default_plus_one_policy || "none";
  const maxGuests = policy === "none" ? 1 : policy === "one" ? 2 : 8;

  const [attending, setAttending] = useState<boolean | null>(existingResponse ? !!existingResponse.attending : null);
  const [checkedMembers, setCheckedMembers] = useState<Set<string>>(new Set([invitee?.id || "", ...groupMembers.map((m) => m.id)]));
  const [numAttending, setNumAttending] = useState(existingResponse?.num_attending || 1);
  const [guestNames, setGuestNames] = useState<string[]>(existingResponse?.guest_names_json ? JSON.parse(existingResponse.guest_names_json) : []);
  const [name, setName] = useState(existingResponse?.responder_name || (invitee ? `${invitee.first_name} ${invitee.last_name}` : ""));
  const [email, setEmail] = useState(existingResponse?.responder_email || invitee?.email || "");
  const [phone, setPhone] = useState(existingResponse?.responder_phone || invitee?.phone || "");
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const a of existingResponse?.answers || []) map[a.question_id] = a.value || "";
    return map;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibleQuestions = questions.filter((q) => !q.show_if_attending || (attending === true && q.show_if_attending === "yes") || (attending === false && q.show_if_attending === "no"));

  function toggleMember(id: string) {
    setCheckedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (attending === null) {
      setError("Let us know whether you can make it.");
      return;
    }
    if (!name.trim()) {
      setError("Please add your name.");
      return;
    }
    for (const q of visibleQuestions) {
      if (q.required && !answers[q.id]) {
        setError(`Please answer: ${q.label}`);
        return;
      }
    }

    let finalNum = numAttending;
    let finalGuestNames = guestNames.filter(Boolean);
    if (attending && isGroupMode) {
      finalNum = checkedMembers.size;
      finalGuestNames = groupMembers.filter((m) => checkedMembers.has(m.id)).map((m) => `${m.first_name} ${m.last_name}`);
    }

    setSaving(true);
    const res = await fetch(`/api/rsvp/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attending,
        numAttending: attending ? finalNum : 0,
        guestNames: attending ? finalGuestNames : [],
        responderName: name,
        responderEmail: email || undefined,
        responderPhone: phone || undefined,
        answers: visibleQuestions.map((q) => ({ questionId: q.id, value: answers[q.id] || "" })),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Something went wrong. Please try again.");
      return;
    }
    onSubmitted();
  }

  return (
    <Shell>
      <EventHeader event={event} />

      <form onSubmit={submit} className="card p-6 mt-4 space-y-5">
        {error && <div className="rounded border border-clay-500/30 bg-clay-500/5 text-clay-600 text-sm px-3 py-2.5">{error}</div>}

        <div>
          <label className="label">Will you be attending?</label>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setAttending(true)} className={`btn ${attending === true ? "bg-moss-500 text-paper" : "btn-secondary"}`}>Yes, I'll be there</button>
            <button type="button" onClick={() => setAttending(false)} className={`btn ${attending === false ? "bg-clay-500 text-paper" : "btn-secondary"}`}>Can't make it</button>
          </div>
        </div>

        {attending === true && isGroupMode && (
          <div>
            <label className="label">Who's coming?</label>
            <div className="space-y-1.5">
              {[{ id: invitee!.id, first_name: invitee!.first_name, last_name: invitee!.last_name }, ...groupMembers.filter((m) => m.id !== invitee?.id)].map((m) => (
                <label key={m.id} className="flex items-center gap-2.5 text-sm text-ink-soft rounded border border-paper-line px-3 py-2">
                  <input type="checkbox" checked={checkedMembers.has(m.id)} onChange={() => toggleMember(m.id)} />
                  {m.first_name} {m.last_name}
                </label>
              ))}
            </div>
          </div>
        )}

        {attending === true && !isGroupMode && policy !== "none" && (
          <div>
            <label className="label">How many in your party (including you)?</label>
            <select className="input" value={numAttending} onChange={(e) => setNumAttending(Number(e.target.value))}>
              {Array.from({ length: maxGuests }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            {numAttending > 1 && (
              <div className="mt-2 space-y-2">
                {Array.from({ length: numAttending - 1 }, (_, i) => (
                  <input
                    key={i}
                    className="input"
                    placeholder={`Guest ${i + 1} name (optional)`}
                    value={guestNames[i] || ""}
                    onChange={(e) => {
                      const next = [...guestNames];
                      next[i] = e.target.value;
                      setGuestNames(next);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {attending !== null && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="label">Your name</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label className="label">Email {invitee?.email ? "" : <span className="text-ink-faint font-normal">(optional)</span>}</label>
                <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <label className="label">Phone <span className="text-ink-faint font-normal">(optional)</span></label>
                <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>

            {visibleQuestions.map((q) => (
              <QuestionField key={q.id} question={q} value={answers[q.id] || ""} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
            ))}

            <button type="submit" disabled={saving} className="btn-primary w-full">{saving ? "Sending…" : existingResponse ? "Update RSVP" : "Send RSVP"}</button>
          </>
        )}
      </form>
    </Shell>
  );
}

function QuestionField({ question, value, onChange }: { question: Question; value: string; onChange: (v: string) => void }) {
  const options: string[] = question.options_json ? JSON.parse(question.options_json) : [];
  const label = (
    <label className="label">{question.label} {question.required ? <span className="text-clay-600">*</span> : null}</label>
  );

  switch (question.type) {
    case "long_text":
      return <div>{label}<textarea className="input min-h-[80px]" value={value} onChange={(e) => onChange(e.target.value)} /></div>;
    case "single_choice":
    case "yes_no": {
      const opts = question.type === "yes_no" ? ["Yes", "No"] : options;
      return (
        <div>
          {label}
          <div className="flex flex-wrap gap-2">
            {opts.map((o) => (
              <button type="button" key={o} onClick={() => onChange(o)} className={`chip border ${value === o ? "bg-wine-500 text-paper border-wine-500" : "border-paper-line text-ink-soft"}`}>{o}</button>
            ))}
          </div>
        </div>
      );
    }
    case "multiple_choice": {
      const selected = value ? value.split("|") : [];
      return (
        <div>
          {label}
          <div className="flex flex-wrap gap-2">
            {options.map((o) => {
              const isSel = selected.includes(o);
              return (
                <button
                  type="button"
                  key={o}
                  onClick={() => onChange(isSel ? selected.filter((s) => s !== o).join("|") : [...selected, o].join("|"))}
                  className={`chip border ${isSel ? "bg-wine-500 text-paper border-wine-500" : "border-paper-line text-ink-soft"}`}
                >
                  {o}
                </button>
              );
            })}
          </div>
        </div>
      );
    }
    case "dropdown":
      return (
        <div>
          {label}
          <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">Choose…</option>
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      );
    case "checkbox":
      return (
        <label className="flex items-center gap-2.5 text-sm text-ink-soft">
          <input type="checkbox" checked={value === "yes"} onChange={(e) => onChange(e.target.checked ? "yes" : "")} />
          {question.label}
        </label>
      );
    case "number":
      return <div>{label}<input type="number" className="input" value={value} onChange={(e) => onChange(e.target.value)} /></div>;
    case "date":
      return <div>{label}<input type="date" className="input" value={value} onChange={(e) => onChange(e.target.value)} /></div>;
    case "time":
      return <div>{label}<input type="time" className="input" value={value} onChange={(e) => onChange(e.target.value)} /></div>;
    case "email":
      return <div>{label}<input type="email" className="input" value={value} onChange={(e) => onChange(e.target.value)} /></div>;
    case "phone":
      return <div>{label}<input className="input" value={value} onChange={(e) => onChange(e.target.value)} /></div>;
    default:
      return <div>{label}<input className="input" value={value} onChange={(e) => onChange(e.target.value)} /></div>;
  }
}
