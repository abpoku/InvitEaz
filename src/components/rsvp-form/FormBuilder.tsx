"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";

interface Question {
  id: string;
  label: string;
  type: string;
  options_json: string | null;
  required: number;
  order_index: number;
  show_if_attending: "yes" | "no" | null;
  kind: "core" | "custom";
  key: string | null;
  active: number;
}

const TYPE_LABELS: Record<string, string> = {
  short_text: "Short text", long_text: "Long text", single_choice: "Single choice",
  multiple_choice: "Multiple choice", dropdown: "Dropdown", yes_no: "Yes / No",
  number: "Number", date: "Date", time: "Time", email: "Email", phone: "Phone", checkbox: "Checkbox",
};

const NEEDS_OPTIONS = ["single_choice", "multiple_choice", "dropdown"];

export function FormBuilder({ eventId }: { eventId: string }) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Question | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/events/${eventId}/questions`);
    const data = await res.json();
    setQuestions((data.questions || []).sort((a: Question, b: Question) => a.order_index - b.order_index));
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [eventId]);

  async function remove(id: string) {
    if (!confirm("Remove this question? Existing answers to it will be kept in your records but hidden from new responses.")) return;
    await fetch(`/api/events/${eventId}/questions/${id}`, { method: "DELETE" });
    load();
  }

  async function toggleActive(q: Question) {
    await fetch(`/api/events/${eventId}/questions/${q.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !q.active }),
    });
    load();
  }

  const coreQuestions = questions.filter((q) => q.kind === "core");
  const customQuestions = questions.filter((q) => q.kind === "custom");

  // Reordering only applies among custom questions — core questions always render first, in a fixed order.
  async function move(index: number, dir: -1 | 1) {
    const next = [...customQuestions];
    const swapWith = index + dir;
    if (swapWith < 0 || swapWith >= next.length) return;
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    setQuestions([...coreQuestions, ...next]);
    await fetch(`/api/events/${eventId}/questions/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: [...coreQuestions, ...next].map((q) => q.id) }),
    });
  }

  return (
    <div className="card p-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl text-ink">RSVP form</h2>
          <p className="mt-1 text-sm text-ink-soft">Your guests are always asked their name; the fields below are also always collected but you can customize them. Add any other questions your event needs.</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary shrink-0">+ Add question</button>
      </div>

      <div className="mt-6 space-y-3">
        {loading ? (
          <p className="text-sm text-ink-faint">Loading…</p>
        ) : (
          coreQuestions.map((q) => (
            <div key={q.id} className="card p-4 flex flex-wrap items-center gap-3 sm:gap-4">
              <span className="chip bg-ink/[0.06] shrink-0">Built in</span>
              <div className="flex-1 min-w-[160px]">
                <p className={`break-words ${q.active ? "text-ink" : "text-ink-faint"}`}>
                  {q.label} {q.required ? <span className="text-clay-600">*</span> : null}
                  {!q.active && <span className="ml-1.5 text-xs text-ink-faint">(hidden)</span>}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0 ml-auto sm:ml-0">
                <button onClick={() => setEditing(q)} className="btn-ghost text-xs">Edit</button>
                {q.key !== "attending" && (
                  <button onClick={() => toggleActive(q)} className="text-xs text-ink-faint hover:text-ink">
                    {q.active ? "Hide" : "Show"}
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-6 space-y-3">
        {!loading && customQuestions.length === 0 ? (
          <div className="card p-10 text-center text-sm text-ink-faint">No custom questions yet — meal choice, transportation, t-shirt size, anything your event needs.</div>
        ) : (
          customQuestions.map((q, idx) => (
            <div key={q.id} className="card p-4 flex flex-wrap items-center gap-3 sm:gap-4">
              <div className="flex flex-col gap-0.5 shrink-0">
                <button onClick={() => move(idx, -1)} disabled={idx === 0} className="text-ink-faint hover:text-ink disabled:opacity-20 text-xs leading-none">▲</button>
                <button onClick={() => move(idx, 1)} disabled={idx === customQuestions.length - 1} className="text-ink-faint hover:text-ink disabled:opacity-20 text-xs leading-none">▼</button>
              </div>
              <div className="flex-1 min-w-[160px]">
                <p className="text-ink break-words">{q.label} {q.required ? <span className="text-clay-600">*</span> : null}</p>
                <p className="text-xs text-ink-faint mt-0.5">
                  {TYPE_LABELS[q.type]}
                  {q.show_if_attending && ` · shown when attending = ${q.show_if_attending}`}
                  {q.options_json && ` · ${JSON.parse(q.options_json).length} options`}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0 ml-auto sm:ml-0">
                <button onClick={() => setEditing(q)} className="btn-ghost text-xs">Edit</button>
                <button onClick={() => remove(q.id)} className="text-xs text-ink-faint hover:text-clay-600">Remove</button>
              </div>
            </div>
          ))
        )}
      </div>

      {(showAdd || editing) && (
        <QuestionModal
          eventId={eventId}
          question={editing}
          onClose={() => { setShowAdd(false); setEditing(null); }}
          onSaved={() => { setShowAdd(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function QuestionModal({
  eventId, question, onClose, onSaved,
}: { eventId: string; question: Question | null; onClose: () => void; onSaved: () => void }) {
  const isCore = question?.kind === "core";
  const isAttending = isCore && question?.key === "attending";
  const [label, setLabel] = useState(question?.label || "");
  const [type, setType] = useState(question?.type || "short_text");
  const [options, setOptions] = useState<string>(question?.options_json ? JSON.parse(question.options_json).join("\n") : "");
  const [required, setRequired] = useState(!!question?.required);
  const [showIf, setShowIf] = useState<"" | "yes" | "no">(question?.show_if_attending || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!label.trim()) {
      setError("Give this question a label.");
      return;
    }
    const optionList = options.split("\n").map((o) => o.trim()).filter(Boolean);
    if (!isCore && NEEDS_OPTIONS.includes(type) && optionList.length < 2) {
      setError("Add at least two options, one per line.");
      return;
    }
    setSaving(true);
    const body: any = { label: label.trim() };
    if (!isCore) {
      body.type = type;
      body.options = NEEDS_OPTIONS.includes(type) ? optionList : undefined;
      body.showIfAttending = showIf || null;
    }
    if (!isAttending) body.required = required;
    const res = question
      ? await fetch(`/api/events/${eventId}/questions/${question.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      : await fetch(`/api/events/${eventId}/questions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Something went wrong.");
      return;
    }
    onSaved();
  }

  return (
    <Modal title={question ? "Edit question" : "Add question"} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <div className="rounded border border-clay-500/30 bg-clay-500/5 text-clay-600 text-sm px-3 py-2.5">{error}</div>}
        <div>
          <label className="label">Question</label>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Meal preference" />
        </div>
        {!isCore && (
          <div>
            <label className="label">Answer type</label>
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
              {Object.entries(TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        )}
        {!isCore && NEEDS_OPTIONS.includes(type) && (
          <div>
            <label className="label">Options <span className="text-ink-faint font-normal">(one per line)</span></label>
            <textarea className="input min-h-[100px]" value={options} onChange={(e) => setOptions(e.target.value)} placeholder={"Chicken\nVegetarian\nVegan"} />
          </div>
        )}
        {!isCore && (
          <div>
            <label className="label">Only show when attending is</label>
            <select className="input" value={showIf} onChange={(e) => setShowIf(e.target.value as any)}>
              <option value="">Always show</option>
              <option value="yes">Yes, attending</option>
              <option value="no">No, not attending</option>
            </select>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" checked={isAttending ? true : required} disabled={isAttending} onChange={(e) => setRequired(e.target.checked)} />
          Required
          {isAttending && <span className="text-ink-faint">— every guest must answer this</span>}
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving…" : "Save question"}</button>
        </div>
      </form>
    </Modal>
  );
}
