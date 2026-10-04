"use client";

import type { InviteeField } from "@/components/invitees/InviteesManager";

/** Renders one invitee field's label + input, for exactly one field's value. Deliberately
 * value/onChange-only — the caller decides where `value` comes from (an AddInviteeModal's
 * core/customFields state, a bulk-edit target value, or an upload preview row) and where the new
 * value gets written, so this same component works across all three without baking in any
 * persistence assumption. */
export function InviteeFieldInput({
  field, value, onChange, groupRsvpMode, groupSuggestions, groupHint,
}: {
  field: InviteeField;
  value: string;
  onChange: (value: string) => void;
  groupRsvpMode?: string;
  groupSuggestions?: string[]; // existing group names, offered as you type
  groupHint?: string;          // e.g. "Will be added to the existing group …"
}) {
  if (field.key === "group") {
    if (groupRsvpMode === "individual") return null;
    const listId = groupSuggestions?.length ? `group-suggestions-${field.id}` : undefined;
    return (
      <div>
        <label className="label" htmlFor={`field-${field.id}`}>{field.label} <span className="text-ink-faint font-normal">(optional)</span></label>
        <input id={`field-${field.id}`} className="input" placeholder="e.g. Johnson Family" list={listId} autoComplete="off" value={value || ""} onChange={(e) => onChange(e.target.value)} />
        {listId && (
          <datalist id={listId}>
            {groupSuggestions!.map((n) => <option key={n} value={n} />)}
          </datalist>
        )}
        {groupHint && <p className="mt-1 text-xs text-ink-faint">{groupHint}</p>}
      </div>
    );
  }
  if (field.key === "is_adult") {
    return (
      <div>
        <label className="label">{field.label}</label>
        <select className="input" value={value || "adult"} onChange={(e) => onChange(e.target.value)}>
          <option value="adult">Adult</option>
          <option value="child">Child</option>
        </select>
      </div>
    );
  }
  if (field.key === "plus_one_policy") {
    return (
      <div>
        <label className="label">{field.label}</label>
        <select className="input" value={value || ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">Use event default</option>
          <option value="none">No plus-ones</option>
          <option value="one">May bring one</option>
          <option value="multiple">May bring multiple</option>
        </select>
      </div>
    );
  }

  const inputType = field.key === "email" ? "email" : field.key === "phone" ? "text" : field.field_type === "checkbox" ? "checkbox" : field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : "text";
  const isCoreOptional = field.key === "email" || field.key === "phone" || field.key === "notes";
  return (
    <div>
      <label className="label">
        {field.label} {field.required ? <span className="text-clay-600">*</span> : isCoreOptional ? <span className="text-ink-faint font-normal">(optional)</span> : null}
      </label>
      {field.field_type === "dropdown" ? (
        <select className="input" value={value || ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {(field.options_json ? JSON.parse(field.options_json) : []).map((o: string) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input type={inputType} className="input" value={value || ""} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}
