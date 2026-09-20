"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import type { InviteeFieldType } from "@/lib/models/invitee-fields";

interface Field {
  id: string;
  key: string;
  label: string;
  kind: "core" | "custom";
  field_type: InviteeFieldType;
  options_json: string | null;
  required: number;
  collect_at_signup: number;
  order_index: number;
  active: number;
}

const TYPE_LABELS: Record<InviteeFieldType, string> = {
  text: "Text", email: "Email", phone: "Phone", number: "Number", date: "Date", dropdown: "Dropdown", checkbox: "Checkbox",
};

export function FieldsManagerModal({
  eventId, nameFormat, onClose, onChanged,
}: { eventId: string; nameFormat: "first_last" | "full"; onClose: () => void; onChanged: () => void }) {
  const [fields, setFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [format, setFormat] = useState(nameFormat);
  const [savingFormat, setSavingFormat] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editingField, setEditingField] = useState<Field | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/events/${eventId}/invitee-fields`);
    if (!res.ok) {
      setError("Couldn't load fields. Try closing and reopening this dialog.");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setFields((data.fields || []).sort((a: Field, b: Field) => a.order_index - b.order_index));
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [eventId]);

  async function setNameFormat(next: "first_last" | "full") {
    setError(null);
    setSavingFormat(true);
    setFormat(next);
    const res = await fetch(`/api/events/${eventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invitee_name_format: next }),
    });
    setSavingFormat(false);
    if (!res.ok) {
      setFormat(nameFormat);
      setError("Couldn't update the name format.");
      return;
    }
    onChanged();
  }

  async function patchField(id: string, patch: Record<string, any>) {
    setError(null);
    const res = await fetch(`/api/events/${eventId}/invitee-fields/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Something went wrong.");
      return;
    }
    load();
    onChanged();
  }

  async function removeField(field: Field) {
    if (!confirm(`Remove "${field.label}"? Any values already collected for it will stop showing up, but nothing is deleted — you can recreate the field later.`)) return;
    setError(null);
    const res = await fetch(`/api/events/${eventId}/invitee-fields/${field.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Something went wrong.");
      return;
    }
    load();
    onChanged();
  }

  async function move(index: number, dir: -1 | 1) {
    const next = [...fields];
    const swapWith = index + dir;
    if (swapWith < 0 || swapWith >= next.length) return;
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    setFields(next);
    await fetch(`/api/events/${eventId}/invitee-fields/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: next.map((f) => f.id) }),
    });
  }

  return (
    <Modal title="Manage invitee fields" onClose={onClose} wide>
      <p className="text-sm text-ink-soft">
        Choose what you collect for each guest — hide fields you don't need, mark others required,
        or add your own. Changes apply to new entries and the RSVP sign-up form right away.
      </p>

      {error && <div className="mt-4 rounded border border-clay-500/30 bg-clay-500/5 text-clay-600 text-sm px-3 py-2.5">{error}</div>}

      <div className="mt-5 card p-4">
        <p className="label mb-2">Guest name</p>
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            disabled={savingFormat}
            onClick={() => setNameFormat("first_last")}
            className={`chip border ${format === "first_last" ? "bg-wine-500 text-paper border-wine-500" : "border-paper-line text-ink-soft"}`}
          >
            First &amp; last name
          </button>
          <button
            type="button"
            disabled={savingFormat}
            onClick={() => setNameFormat("full")}
            className={`chip border ${format === "full" ? "bg-wine-500 text-paper border-wine-500" : "border-paper-line text-ink-soft"}`}
          >
            Single full name
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {loading ? (
          <p className="text-sm text-ink-faint">Loading…</p>
        ) : (
          fields.map((f, idx) => (
            <div key={f.id} className={`card p-4 flex flex-wrap items-center gap-3 ${!f.active ? "opacity-60" : ""}`}>
              <div className="flex flex-col gap-0.5 shrink-0">
                <button onClick={() => move(idx, -1)} disabled={idx === 0} className="text-ink-faint hover:text-ink disabled:opacity-20 text-xs leading-none">▲</button>
                <button onClick={() => move(idx, 1)} disabled={idx === fields.length - 1} className="text-ink-faint hover:text-ink disabled:opacity-20 text-xs leading-none">▼</button>
              </div>
              <div className="flex-1 min-w-[160px]">
                <p className="text-ink flex items-center gap-1.5">
                  {f.label}
                  <button
                    onClick={() => { setShowAdd(false); setEditingField(f); }}
                    title={f.kind === "core" ? "Rename this field" : "Edit this field"}
                    className="text-ink-faint hover:text-ink"
                  >
                    ✎
                  </button>
                </p>
                <p className="text-xs text-ink-faint mt-0.5">
                  {TYPE_LABELS[f.field_type]}{f.kind === "core" ? " · built in" : " · custom"}
                  {f.options_json && ` · ${JSON.parse(f.options_json).length} options`}
                </p>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-ink-soft shrink-0">
                <input type="checkbox" checked={!!f.active} onChange={(e) => patchField(f.id, { active: e.target.checked })} />
                Active
              </label>
              <label className={`flex items-center gap-1.5 text-xs shrink-0 ${f.active ? "text-ink-soft" : "text-ink-faint"}`}>
                <input type="checkbox" disabled={!f.active} checked={!!f.required} onChange={(e) => patchField(f.id, { required: e.target.checked })} />
                Required
              </label>
              <label className={`flex items-center gap-1.5 text-xs shrink-0 ${f.active ? "text-ink-soft" : "text-ink-faint"}`}>
                <input type="checkbox" disabled={!f.active} checked={!!f.collect_at_signup} onChange={(e) => patchField(f.id, { collectAtSignup: e.target.checked })} />
                Ask at sign-up
              </label>
              {f.kind === "custom" && (
                <button onClick={() => removeField(f)} className="text-xs text-ink-faint hover:text-clay-600 shrink-0">Remove</button>
              )}
            </div>
          ))
        )}
      </div>

      {showAdd || editingField ? (
        <FieldForm
          eventId={eventId}
          field={editingField}
          onCancel={() => { setShowAdd(false); setEditingField(null); }}
          onSaved={() => { setShowAdd(false); setEditingField(null); load(); onChanged(); }}
        />
      ) : (
        <button onClick={() => setShowAdd(true)} className="btn-secondary mt-4">+ Add custom field</button>
      )}

      <div className="flex justify-end pt-5">
        <button onClick={onClose} className="btn-primary">Done</button>
      </div>
    </Modal>
  );
}

function FieldForm({
  eventId, field, onCancel, onSaved,
}: { eventId: string; field: Field | null; onCancel: () => void; onSaved: () => void }) {
  const isEdit = !!field;
  const isCore = field?.kind === "core";
  const [label, setLabel] = useState(field?.label || "");
  const [fieldType, setFieldType] = useState<InviteeFieldType>(field?.field_type || "text");
  const [options, setOptions] = useState<string>(field?.options_json ? (JSON.parse(field.options_json) as string[]).join("\n") : "");
  const [required, setRequired] = useState(false);
  const [collectAtSignup, setCollectAtSignup] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!label.trim()) {
      setError("Give this field a label.");
      return;
    }
    const optionList = options.split("\n").map((o) => o.trim()).filter(Boolean);
    if (!isCore && fieldType === "dropdown" && optionList.length < 2) {
      setError("Add at least two options, one per line.");
      return;
    }
    setSaving(true);
    const res = isEdit
      ? await fetch(`/api/events/${eventId}/invitee-fields/${field!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            isCore
              ? { label: label.trim() }
              : { label: label.trim(), field_type: fieldType, options: fieldType === "dropdown" ? optionList : undefined }
          ),
        })
      : await fetch(`/api/events/${eventId}/invitee-fields`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: label.trim(), field_type: fieldType, options: fieldType === "dropdown" ? optionList : undefined, required, collectAtSignup }),
        });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Something went wrong.");
      return;
    }
    onSaved();
  }

  return (
    <form onSubmit={submit} className="mt-4 card p-4 space-y-3">
      {error && <div className="rounded border border-clay-500/30 bg-clay-500/5 text-clay-600 text-sm px-3 py-2.5">{error}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Field label</label>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="T-Shirt size" autoFocus />
        </div>
        {!isCore && (
          <div>
            <label className="label">Type</label>
            <select className="input" value={fieldType} onChange={(e) => setFieldType(e.target.value as InviteeFieldType)}>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        )}
      </div>
      {!isCore && fieldType === "dropdown" && (
        <div>
          <label className="label">Options <span className="text-ink-faint font-normal">(one per line)</span></label>
          <textarea className="input min-h-[80px]" value={options} onChange={(e) => setOptions(e.target.value)} placeholder={"Small\nMedium\nLarge"} />
        </div>
      )}
      {isCore && (
        <p className="text-xs text-ink-faint">Only the label can be changed for a built-in field — its answer type stays the same since the rest of the app depends on it.</p>
      )}
      {!isEdit && (
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
            Required
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={collectAtSignup} onChange={(e) => setCollectAtSignup(e.target.checked)} />
            Ask guests who self sign-up
          </label>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="btn-ghost">Cancel</button>
        <button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving…" : isEdit ? "Save changes" : "Add field"}</button>
      </div>
    </form>
  );
}
