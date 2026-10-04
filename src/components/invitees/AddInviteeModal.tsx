"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { fullName } from "@/lib/utils";
import { InviteeFieldInput } from "@/components/invitees/InviteeFieldInput";
import type { InviteeField, Assembly, InviteeRow } from "@/components/invitees/InviteesManager";

/** Tolerates a malformed custom_fields column (e.g. the literal string "null" instead of a real
 * SQL NULL) — never let a hydration quirk turn into a plain object other code assumes it is. */
function parseCustomFields(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function AddInviteeModal({
  eventId, groupRsvpMode, nameFormat, fields, assemblies, invitee, onClose, onSaved, groups = [],
}: {
  eventId: string; groupRsvpMode: string; nameFormat: "first_last" | "full"; fields: InviteeField[]; assemblies: Assembly[];
  invitee?: InviteeRow; onClose: () => void; onSaved: () => void;
  // Existing groups, so typing a household's name joins it instead of creating a duplicate.
  groups?: { id: string; name: string; assembly_id: string | null; memberCount: number }[];
}) {
  const [firstName, setFirstName] = useState(() =>
    invitee ? (nameFormat === "full" ? fullName(invitee.first_name, invitee.last_name) : invitee.first_name) : ""
  );
  const [lastName, setLastName] = useState(invitee?.last_name || "");
  const [assemblyId, setAssemblyId] = useState(invitee?.assembly_id || "");
  const [core, setCore] = useState<Record<string, string>>(() => ({
    email: invitee?.email || "",
    phone: invitee?.phone || "",
    notes: invitee?.notes || "",
    group: invitee?.group_name || "",
    is_adult: invitee ? (invitee.is_adult ? "adult" : "child") : "adult",
    plus_one_policy: invitee?.plus_one_policy || "",
  }));
  const [customFields, setCustomFields] = useState<Record<string, string>>(() =>
    parseCustomFields(invitee?.custom_fields ?? null)
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const emailActive = fields.some((f) => f.key === "email");
  const phoneActive = fields.some((f) => f.key === "phone");
  const groupField = fields.find((f) => f.key === "group");
  // Same matching rule as the server (findGroupByName): same clone, name ignoring case/spaces.
  const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const typedGroup = core.group.trim();
  const matchedGroup = typedGroup
    ? groups.find((g) => sameName(g.name, typedGroup) && (g.assembly_id || "") === (assemblyId || ""))
    : undefined;
  const groupUnchanged = !!invitee?.group_name && sameName(invitee.group_name, typedGroup);

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

    // Resolve the typed group name only when it actually changed. The groups endpoint reuses an
    // existing group with the same name in the same clone (findGroupByName), so adding family
    // members one at a time puts them all in one household rather than one group each.
    let groupId: string | null = invitee?.group_id ?? null;
    const originalGroupName = invitee?.group_name || "";
    if (groupField && typedGroup && !groupUnchanged) {
      let gData: any = {};
      let gOk = false;
      try {
        const gRes = await fetch(`/api/events/${eventId}/groups`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: typedGroup, assemblyId: assemblyId || undefined }),
        });
        try { gData = await gRes.json(); } catch {}
        gOk = gRes.ok && !!gData.group;
      } catch {}
      if (!gOk) {
        setSaving(false);
        setError(gData.error || "We couldn't save the group. Please try again.");
        return;
      }
      groupId = gData.group.id;
    } else if (groupField && !typedGroup && originalGroupName) {
      groupId = null;
    }

    const body = invitee
      ? {
          // Editing: send explicit nulls so a cleared field actually clears in the database,
          // rather than the "|| undefined" the add flow uses below (which the PATCH endpoint
          // treats as "leave unchanged" — fine when creating, wrong when clearing an edit).
          firstName: firstName.trim(),
          lastName: nameFormat === "full" ? "" : lastName.trim(),
          email: core.email || null,
          phone: core.phone || null,
          isAdult: core.is_adult !== "child",
          plusOnePolicy: (core.plus_one_policy as any) || null,
          notes: core.notes || null,
          groupId,
          assemblyId: assemblyId || null,
          customFields,
        }
      : {
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
        };

    const res = await fetch(
      invitee ? `/api/events/${eventId}/invitees/${invitee.id}` : `/api/events/${eventId}/invitees`,
      { method: invitee ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    );
    setSaving(false);
    // A server crash returns a non-JSON body (e.g. an empty 500) — never let that throw here and
    // fail silently with no feedback; always surface *something* to the user.
    let data: { error?: string } = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      setError(data.error || "Something went wrong. Please try again.");
      return;
    }
    onSaved();
  }

  return (
    <Modal title={invitee ? "Edit invitee" : "Add invitee"} onClose={onClose}>
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
            <label className="label">Clone <span className="text-ink-faint font-normal">(optional)</span></label>
            <select className="input" value={assemblyId} onChange={(e) => setAssemblyId(e.target.value)}>
              <option value="">Unassigned</option>
              {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        )}

        {fields.map((f) => (
          <InviteeFieldInput
            key={f.id}
            field={f}
            groupRsvpMode={groupRsvpMode}
            value={f.key === "group" ? core.group : f.kind === "core" ? core[f.key] : customFields[f.key]}
            onChange={(v) => (f.kind === "core" ? setCore((c) => ({ ...c, [f.key]: v })) : setCustomFields((c) => ({ ...c, [f.key]: v })))}
            groupSuggestions={f.key === "group" ? [...new Set(groups.filter((g) => (g.assembly_id || "") === (assemblyId || "")).map((g) => g.name))] : undefined}
            groupHint={
              f.key === "group" && typedGroup && !groupUnchanged
                ? matchedGroup
                  ? `Will be added to the existing group "${matchedGroup.name}" (${matchedGroup.memberCount} member${matchedGroup.memberCount === 1 ? "" : "s"}).`
                  : `A new group "${typedGroup}" will be created.`
                : undefined
            }
          />
        ))}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? "Saving…" : invitee ? "Save changes" : "Add invitee"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
