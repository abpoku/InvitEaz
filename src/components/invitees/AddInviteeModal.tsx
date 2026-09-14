"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import type { InviteeField, Assembly } from "@/components/invitees/InviteesManager";

export function AddInviteeModal({
  eventId, groupRsvpMode, nameFormat, fields, assemblies, onClose, onAdded,
}: {
  eventId: string; groupRsvpMode: string; nameFormat: "first_last" | "full"; fields: InviteeField[]; assemblies: Assembly[];
  onClose: () => void; onAdded: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [assemblyId, setAssemblyId] = useState("");
  const [core, setCore] = useState<Record<string, string>>({});
  const [customFields, setCustomFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const emailActive = fields.some((f) => f.key === "email");
  const phoneActive = fields.some((f) => f.key === "phone");
  const groupField = fields.find((f) => f.key === "group");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!firstName.trim()) {
      setError(nameFormat === "full" ? "Name is required." : "First and last name are required.");
      return;
    }
    if (nameFormat === "first_last" && !lastName.trim()) {
      setError("First and last name are required.");
      return;
    }
    if ((emailActive || phoneActive) && !core.email && !core.phone) {
      setError("Add an email or phone number so this invitee can be reached.");
      return;
    }
    for (const f of fields) {
      if (!f.required || f.key === "is_adult" || f.key === "plus_one_policy") continue;
      const value = f.kind === "custom" ? customFields[f.key] : core[f.key];
      if (!value) {
        setError(`${f.label} is required.`);
        return;
      }
    }
    setSaving(true);

    let groupId: string | null = null;
    if (groupField && core.group) {
      const gRes = await fetch(`/api/events/${eventId}/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: core.group, assemblyId: assemblyId || undefined }),
      });
      if (gRes.ok) {
        const gData = await gRes.json();
        groupId = gData.group.id;
      }
    }

    const res = await fetch(`/api/events/${eventId}/invitees`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: firstName.trim(),
        lastName: nameFormat === "full" ? "" : lastName.trim(),
        email: core.email || undefined,
        phone: core.phone || undefined,
        isAdult: core.is_adult !== "child",
        plusOnePolicy: (core.plus_one_policy as any) || null,
        notes: core.notes || undefined,
        groupId,
        assemblyId: assemblyId || null,
        customFields: Object.keys(customFields).length ? customFields : undefined,
      }),
    });
    setSaving(false);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Something went wrong.");
      return;
    }
    onAdded();
  }

  return (
    <Modal title="Add invitee" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <div className="rounded border border-clay-500/30 bg-clay-500/5 text-clay-600 text-sm px-3 py-2.5">{error}</div>}

        {nameFormat === "full" ? (
          <div>
            <label className="label">Full name</label>
            <input className="input" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">First name</label>
              <input className="input" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <label className="label">Last name</label>
              <input className="input" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
        )}

        {assemblies.length > 0 && (
          <div>
            <label className="label">Assembly <span className="text-ink-faint font-normal">(optional)</span></label>
            <select className="input" value={assemblyId} onChange={(e) => setAssemblyId(e.target.value)}>
              <option value="">Unassigned</option>
              {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        )}

        {fields.map((f) => {
          if (f.key === "group") {
            if (groupRsvpMode === "individual") return null;
            return (
              <div key={f.id}>
                <label className="label">{f.label} <span className="text-ink-faint font-normal">(optional)</span></label>
                <input className="input" placeholder="e.g. Johnson Family" value={core.group || ""} onChange={(e) => setCore((c) => ({ ...c, group: e.target.value }))} />
              </div>
            );
          }
          if (f.key === "is_adult") {
            return (
              <div key={f.id}>
                <label className="label">{f.label}</label>
                <select className="input" value={core.is_adult || "adult"} onChange={(e) => setCore((c) => ({ ...c, is_adult: e.target.value }))}>
                  <option value="adult">Adult</option>
                  <option value="child">Child</option>
                </select>
              </div>
            );
          }
          if (f.key === "plus_one_policy") {
            return (
              <div key={f.id}>
                <label className="label">{f.label}</label>
                <select className="input" value={core.plus_one_policy || ""} onChange={(e) => setCore((c) => ({ ...c, plus_one_policy: e.target.value }))}>
                  <option value="">Use event default</option>
                  <option value="none">No plus-ones</option>
                  <option value="one">May bring one</option>
                  <option value="multiple">May bring multiple</option>
                </select>
              </div>
            );
          }
          const inputType = f.key === "email" ? "email" : f.key === "phone" ? "text" : f.field_type === "checkbox" ? "checkbox" : f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : "text";
          const isCoreOptional = f.key === "email" || f.key === "phone" || f.key === "notes";
          return (
            <div key={f.id}>
              <label className="label">
                {f.label} {f.required ? <span className="text-clay-600">*</span> : isCoreOptional ? <span className="text-ink-faint font-normal">(optional)</span> : null}
              </label>
              {f.field_type === "dropdown" ? (
                <select
                  className="input"
                  value={f.kind === "core" ? core[f.key] || "" : customFields[f.key] || ""}
                  onChange={(e) => (f.kind === "core" ? setCore((c) => ({ ...c, [f.key]: e.target.value })) : setCustomFields((c) => ({ ...c, [f.key]: e.target.value })))}
                >
                  <option value="">Choose…</option>
                  {(f.options_json ? JSON.parse(f.options_json) : []).map((o: string) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  type={inputType}
                  className="input"
                  value={f.kind === "core" ? core[f.key] || "" : customFields[f.key] || ""}
                  onChange={(e) => (f.kind === "core" ? setCore((c) => ({ ...c, [f.key]: e.target.value })) : setCustomFields((c) => ({ ...c, [f.key]: e.target.value })))}
                />
              )}
            </div>
          );
        })}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? "Adding…" : "Add invitee"}</button>
        </div>
      </form>
    </Modal>
  );
}
