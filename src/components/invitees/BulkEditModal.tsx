"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { InviteeFieldInput } from "@/components/invitees/InviteeFieldInput";
import type { InviteeField } from "@/components/invitees/InviteesManager";

/** Shared bulk-edit UI: pick one field, set one value, apply to every selected invitee/row.
 * Entirely parameterized through `onApply` — the live invitees page posts to the bulk API and
 * reloads; the upload "fix" step mutates in-memory preview rows with no network call at all. */
export function BulkEditModal({
  fields, groupRsvpMode, count, onApply, onClose,
}: {
  fields: InviteeField[];
  groupRsvpMode: string;
  count: number;
  onApply: (fieldKey: string, value: string) => Promise<void> | void;
  onClose: () => void;
}) {
  // Bulk-renaming a group would need per-row group create-or-reuse resolution — a heavier
  // operation out of scope for a flat field-value apply, so it's excluded from the picker here.
  const editable = fields.filter((f) => f.key !== "group");
  const [fieldKey, setFieldKey] = useState(editable[0]?.key || "");
  const [value, setValue] = useState("");
  const [applying, setApplying] = useState(false);

  const field = editable.find((f) => f.key === fieldKey);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!field) return;
    setApplying(true);
    await onApply(field.key, value);
    setApplying(false);
    onClose();
  }

  return (
    <Modal title={`Bulk edit ${count} invitee${count === 1 ? "" : "s"}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">Field to change</label>
          <select className="input" value={fieldKey} onChange={(e) => { setFieldKey(e.target.value); setValue(""); }}>
            {editable.map((f) => <option key={f.id} value={f.key}>{f.label}</option>)}
          </select>
        </div>

        {field && <InviteeFieldInput field={field} value={value} onChange={setValue} groupRsvpMode={groupRsvpMode} />}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={applying || !field} className="btn-primary">
            {applying ? "Applying…" : `Apply to ${count} invitee${count === 1 ? "" : "s"}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
