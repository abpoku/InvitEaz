"use client";

import { useEffect, useRef, useState } from "react";
import { Shell, MessageScreen, EventHeader, QuestionField, type Question } from "@/components/rsvp/RsvpExperience";
import { InviteeFieldInput } from "@/components/invitees/InviteeFieldInput";
import type { InviteeField } from "@/components/invitees/InviteesManager";
import { formatCurrency } from "@/lib/utils";

interface Member {
  id: string;
  first_name: string;
  last_name: string;
  added_by_guest: boolean;
  rsvp_status: "attending" | "declined" | "maybe" | null;
  fieldValues: Record<string, string>;
  answers: { question_id: string; value: string | null }[];
}
interface Data {
  event: any;
  group: { id: string; name: string };
  members: Member[];
  questions: Question[];
  fields: InviteeField[];
  allowance: { extraGuests: number; guestsAdded: number };
  // Null when the event has no ticketing configured.
  tickets: {
    members: { inviteeId: string; name: string; tier: string; priceCents: number }[];
    owedCents: number;
    paidCents: number;
    balanceCents: number;
  } | null;
  responder: { name: string; email: string; phone: string } | null;
  locked: boolean;
}

export function GroupRsvpExperience({ token }: { token: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  async function load() {
    setError(null);
    try {
      const res = await fetch(`/api/g/${token}`);
      let json: any = {};
      try { json = await res.json(); } catch {}
      if (!res.ok) {
        setError(json.error || "This invitation link isn't valid.");
        return;
      }
      setData(json);
    } catch {
      setError("We couldn't reach the server just now. Please refresh to try again.");
    }
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

  const anyResponded = data.members.some((m) => m.rsvp_status);
  if (anyResponded && !editing) {
    return <GroupConfirmation data={data} onEdit={() => setEditing(true)} />;
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
  return <GroupRsvpForm data={data} token={token} onSubmitted={() => { setEditing(false); load(); }} />;
}

function GroupBanner({ name }: { name: string }) {
  return (
    <div className="card p-5 mb-4 text-center border-wine-500/30 bg-wine-500/[0.04]">
      <p className="text-[11px] uppercase tracking-[0.14em] text-wine-600 font-medium">Group invitation</p>
      <p className="mt-1.5 font-serif text-xl text-ink leading-snug">
        This is a Group Invitation for <span className="text-wine-700">{name}</span>
      </p>
      <p className="mt-1.5 text-sm text-ink-soft">You can respond for everyone in your group on this page.</p>
    </div>
  );
}

function memberName(m: { first_name: string; last_name: string }) {
  return [m.first_name, m.last_name].filter(Boolean).join(" ");
}

function GroupConfirmation({ data, onEdit }: { data: Data; onEdit: () => void }) {
  const { event, members } = data;
  const attending = members.filter((m) => m.rsvp_status === "attending").length;
  return (
    <Shell>
      <GroupBanner name={data.group.name} />
      <EventHeader event={event} />
      <div className="card p-6 mt-4">
        <p className="font-serif text-xl text-ink text-center">
          {attending > 0 ? "Your group's RSVP is in!" : "Thanks for letting us know"}
        </p>
        <p className="mt-1 text-sm text-ink-faint text-center">{attending} of {members.length} attending</p>
        <ul className="mt-5 divide-y divide-paper-line border-y border-paper-line">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="text-ink">{memberName(m)}</span>
              <StatusChip status={m.rsvp_status} />
            </li>
          ))}
        </ul>
        {attending > 0 && event.instructions && <p className="mt-4 text-sm text-ink-soft">{event.instructions}</p>}
        <div className="text-center">
          {!data.locked && <button onClick={onEdit} className="btn-secondary mt-6">Change your group&apos;s response</button>}
          {data.locked && <p className="mt-4 text-xs text-ink-faint">RSVPs are closed — these are your final responses.</p>}
        </div>
      </div>
      {data.tickets && <TicketSummary tickets={data.tickets} />}
    </Shell>
  );
}

/** The group's ticket price, payments, and balance — the same figures the planner's Tickets tab
 * shows for this group (both come from getGroupTicketBalance's shared rule). Payments are
 * recorded by the planner; there's no way to pay from here. */
function TicketSummary({ tickets }: { tickets: NonNullable<Data["tickets"]> }) {
  const { owedCents, paidCents, balanceCents } = tickets;
  return (
    <div className="card p-6 mt-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-serif text-lg text-ink">Tickets</p>
        {owedCents > 0 && balanceCents <= 0 && <span className="chip bg-moss-50 text-moss-600">Paid in full</span>}
      </div>
      <ul className="mt-3 divide-y divide-paper-line border-y border-paper-line text-sm">
        {tickets.members.map((m) => (
          <li key={m.inviteeId} className="flex items-center justify-between gap-3 py-2">
            <span className="text-ink">
              {m.name}
              {m.tier && <span className="text-ink-faint"> · {m.tier}</span>}
            </span>
            <span className="text-ink-soft tabular-nums">{formatCurrency(m.priceCents)}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-3 space-y-1.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-ink-soft">Group ticket price</dt>
          <dd className="text-ink tabular-nums">{formatCurrency(owedCents)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-soft">Amount paid</dt>
          <dd className="text-ink tabular-nums">{formatCurrency(paidCents)}</dd>
        </div>
        <div className="flex justify-between gap-3 pt-2 border-t border-paper-line font-medium">
          <dt className="text-ink">{balanceCents < 0 ? "Credit" : "Balance owed"}</dt>
          <dd className={`tabular-nums ${balanceCents > 0 ? "text-wine-700" : "text-moss-600"}`}>{formatCurrency(Math.abs(balanceCents))}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-ink-faint">Payments are recorded by the organizer. Contact them with any questions about your balance.</p>
    </div>
  );
}

function StatusChip({ status }: { status: Member["rsvp_status"] }) {
  if (status === "attending") return <span className="chip bg-moss-50 text-moss-600">Attending</span>;
  if (status === "declined") return <span className="chip bg-clay-500/10 text-clay-600">Not attending</span>;
  if (status === "maybe") return <span className="chip bg-brass-500/10 text-brass-600">Maybe</span>;
  return <span className="chip bg-ink/[0.06] text-ink-faint">No response yet</span>;
}

interface Draft {
  key: string; // invitee id, or a temporary id for a guest being added
  inviteeId?: string;
  addedByGuest: boolean;
  firstName: string;
  lastName: string;
  attending: boolean | null;
  fieldValues: Record<string, string>;
  answers: Record<string, string>;
}

function GroupRsvpForm({ data, token, onSubmitted }: { data: Data; token: string; onSubmitted: () => void }) {
  const { event, questions, fields, allowance } = data;
  const fullNameFormat = event.invitee_name_format === "full";
  const attendingQ = questions.find((q) => q.key === "attending");
  const emailQ = questions.find((q) => q.key === "email");
  const phoneQ = questions.find((q) => q.key === "phone");
  const emailShown = !emailQ || !!emailQ.active;
  const phoneShown = !phoneQ || !!phoneQ.active;
  const customQuestions = questions.filter((q) => q.kind === "custom" && q.active);
  const anyResponded = data.members.some((m) => m.rsvp_status);

  const [drafts, setDrafts] = useState<Draft[]>(() =>
    data.members.map((m) => ({
      key: m.id,
      inviteeId: m.id,
      addedByGuest: m.added_by_guest,
      // A single-full-name event keeps the whole name in first_name (last_name is "").
      firstName: fullNameFormat ? memberName(m) : m.first_name,
      lastName: fullNameFormat ? "" : m.last_name,
      attending: m.rsvp_status === "attending" ? true : m.rsvp_status === "declined" ? false : null,
      fieldValues: { ...m.fieldValues },
      answers: Object.fromEntries(m.answers.map((a) => [a.question_id, a.value || ""])),
    }))
  );
  const [removed, setRemoved] = useState<string[]>([]);
  const [responder, setResponder] = useState(data.responder || { name: "", email: "", phone: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const nextTemp = useRef(1);

  const guestCount = drafts.filter((d) => d.addedByGuest).length;
  const remaining = allowance.extraGuests - guestCount;

  function update(key: string, patch: Partial<Draft>) {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  function addGuest() {
    const key = `new-${nextTemp.current++}`;
    setDrafts((prev) => [...prev, { key, addedByGuest: true, firstName: "", lastName: "", attending: true, fieldValues: {}, answers: {} }]);
  }

  function removeGuest(d: Draft) {
    setDrafts((prev) => prev.filter((x) => x.key !== d.key));
    if (d.inviteeId) setRemoved((prev) => [...prev, d.inviteeId!]);
  }

  function visibleQuestions(attending: boolean | null) {
    return customQuestions.filter(
      (q) => !q.show_if_attending || (attending === true && q.show_if_attending === "yes") || (attending === false && q.show_if_attending === "no")
    );
  }

  function fail(message: string) {
    setError(message);
    requestAnimationFrame(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    for (const d of drafts) {
      const label = d.firstName.trim() || "each guest";
      if (!d.firstName.trim()) return fail("Please add a name for every guest.");
      if (d.attending === null) return fail(`Please choose whether ${label} will attend.`);
      for (const f of fields) {
        if (f.required && !(d.fieldValues[f.key] || "").trim()) return fail(`Please fill in ${f.label} for ${label}.`);
      }
      for (const q of visibleQuestions(d.attending)) {
        if (q.required && !d.answers[q.id]) return fail(`Please answer "${q.label}" for ${label}.`);
      }
    }
    if (!responder.name.trim()) return fail("Please add your name.");
    if (emailShown && emailQ?.required && !responder.email.trim()) return fail("Please add your email.");
    if (phoneShown && phoneQ?.required && !responder.phone.trim()) return fail("Please add your phone number.");

    setSaving(true);
    try {
      const res = await fetch(`/api/g/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          responder: {
            name: responder.name,
            email: emailShown ? responder.email : "",
            phone: phoneShown ? responder.phone : "",
          },
          removeInviteeIds: removed,
          members: drafts.map((d) => ({
            inviteeId: d.inviteeId,
            firstName: d.firstName,
            lastName: fullNameFormat ? "" : d.lastName,
            attending: d.attending,
            fieldValues: d.fieldValues,
            answers: visibleQuestions(d.attending).map((q) => ({ questionId: q.id, value: d.answers[q.id] || "" })),
          })),
        }),
      });
      let json: any = {};
      try { json = await res.json(); } catch {}
      if (!res.ok) return fail(json.error || "Something went wrong. Please try again.");
      onSubmitted();
    } catch {
      fail("We couldn't reach the server just now. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Shell>
      <GroupBanner name={data.group.name} />
      <EventHeader event={event} />
      {data.tickets && <TicketSummary tickets={data.tickets} />}

      <form onSubmit={submit} className="mt-4 space-y-4">
        {error && (
          <div ref={errorRef} className="rounded border border-clay-500/30 bg-clay-500/5 text-clay-600 text-sm px-3 py-2.5">{error}</div>
        )}

        {drafts.map((d, idx) => (
          <div key={d.key} className="card p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-wide text-ink-faint">
                {d.addedByGuest ? "Additional guest" : `Guest ${idx + 1}`}
              </p>
              {d.addedByGuest && (
                <button type="button" onClick={() => removeGuest(d)} className="text-xs text-ink-faint hover:text-clay-600">Remove</button>
              )}
            </div>

            {fullNameFormat ? (
              <div>
                <label className="label">Full name</label>
                <input className="input" value={d.firstName} onChange={(e) => update(d.key, { firstName: e.target.value })} />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">First name</label>
                  <input className="input" value={d.firstName} onChange={(e) => update(d.key, { firstName: e.target.value })} />
                </div>
                <div>
                  <label className="label">Last name</label>
                  <input className="input" value={d.lastName} onChange={(e) => update(d.key, { lastName: e.target.value })} />
                </div>
              </div>
            )}

            <div>
              <label className="label">{attendingQ?.label || "Will you be attending?"}</label>
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => update(d.key, { attending: true })} className={`btn ${d.attending === true ? "bg-moss-500 text-paper" : "btn-secondary"}`}>Attending</button>
                <button type="button" onClick={() => update(d.key, { attending: false })} className={`btn ${d.attending === false ? "bg-clay-500 text-paper" : "btn-secondary"}`}>Not attending</button>
              </div>
            </div>

            {fields.map((f) => (
              <InviteeFieldInput
                key={f.id}
                field={f}
                value={d.fieldValues[f.key] || ""}
                onChange={(v) => update(d.key, { fieldValues: { ...d.fieldValues, [f.key]: v } })}
              />
            ))}

            {visibleQuestions(d.attending).map((q) => (
              <QuestionField
                key={q.id}
                question={q}
                value={d.answers[q.id] || ""}
                onChange={(v) => update(d.key, { answers: { ...d.answers, [q.id]: v } })}
              />
            ))}
          </div>
        ))}

        {allowance.extraGuests > 0 && (
          <div className="card p-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-soft">
              {remaining > 0
                ? `You can add ${remaining} more guest${remaining === 1 ? "" : "s"} to your group.`
                : "You've added every additional guest your invitation includes."}
            </p>
            {remaining > 0 && <button type="button" onClick={addGuest} className="btn-secondary">+ Add a guest</button>}
          </div>
        )}

        <div className="card p-5 space-y-4">
          <p className="text-xs uppercase tracking-wide text-ink-faint">Your details</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="label">Your name</label>
              <input className="input" value={responder.name} onChange={(e) => setResponder({ ...responder, name: e.target.value })} />
            </div>
            {emailShown && (
              <div>
                <label className="label">{emailQ?.label || "Email"} {emailQ?.required ? "" : <span className="text-ink-faint font-normal">(optional)</span>}</label>
                <input type="email" className="input" value={responder.email} onChange={(e) => setResponder({ ...responder, email: e.target.value })} />
              </div>
            )}
            {phoneShown && (
              <div>
                <label className="label">{phoneQ?.label || "Phone"} {phoneQ?.required ? "" : <span className="text-ink-faint font-normal">(optional)</span>}</label>
                <input className="input" value={responder.phone} onChange={(e) => setResponder({ ...responder, phone: e.target.value })} />
              </div>
            )}
          </div>
          <button type="submit" disabled={saving} className="btn-primary w-full">
            {saving ? "Sending…" : anyResponded ? "Update group RSVP" : "Send group RSVP"}
          </button>
        </div>
      </form>
    </Shell>
  );
}
