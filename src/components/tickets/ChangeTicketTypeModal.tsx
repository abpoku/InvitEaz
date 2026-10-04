"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { formatCurrency } from "@/lib/utils";
import type { PaymentTarget } from "@/components/tickets/ReceivePaymentModal";

/** Changes the ticket type for one invitee, or for each member of a group (with a "set everyone"
 * shortcut for the common case). Only the configured tiers are offered; the server rejects
 * anything else. */
export function ChangeTicketTypeModal({
  eventId, target, fieldLabel, tiers, members, onClose, onSaved,
}: {
  eventId: string;
  target: PaymentTarget;
  fieldLabel: string;
  tiers: { name: string; priceCents: number }[];
  members: { id: string; name: string; tier: string; declined?: boolean }[]; // one entry for an invitee
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(members.map((m) => [m.id, m.tier])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const price = (tier: string) => tiers.find((t) => t.name === tier)?.priceCents ?? 0;
  // Declined invitees owe $0 whatever their ticket type (owedFor in models/ticketing.ts).
  const before = members.reduce((sum, m) => sum + (m.declined ? 0 : price(m.tier)), 0);
  const after = members.reduce((sum, m) => sum + (m.declined ? 0 : price(values[m.id] || "")), 0);
  const changed = members.filter((m) => (values[m.id] || "") !== m.tier);
  // A member holding a value that's no longer a configured tier keeps it unless the planner changes it.
  const isKnown = (tier: string) => !tier || tiers.some((t) => t.name === tier);

  async function save() {
    setError(null);
    if (changed.length === 0) return onClose();
    setSaving(true);
    try {
      const res = await fetch(`/api/events/${eventId}/ticketing/assignments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignments: changed.map((m) => ({ inviteeId: m.id, tier: values[m.id] || "" })) }),
      });
      let data: any = {};
      try { data = await res.json(); } catch {}
      if (!res.ok) return setError(data.error || "Something went wrong. Please try again.");
      onSaved();
      onClose();
    } catch {
      setError("We couldn't reach the server just now. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const options = (current: string) => (
    <>
      <option value="">No {fieldLabel.toLowerCase()}</option>
      {!isKnown(current) && <option value={current}>{current} (no longer offered)</option>}
      {tiers.map((t) => <option key={t.name} value={t.name}>{t.name} — {formatCurrency(t.priceCents)}</option>)}
    </>
  );

  return (
    <Modal title={`Change ${fieldLabel.toLowerCase()} — ${target.label}`} onClose={onClose}>
      <div className="space-y-4">
        {error && <div className="rounded border border-clay-500/30 bg-clay-500/5 text-clay-600 text-sm px-3 py-2.5">{error}</div>}
        {tiers.length === 0 ? (
          <p className="text-sm text-ink-faint">No ticket types are set up yet — add them from the Ticketing card on Overview.</p>
        ) : (
          <>
            {target.type === "group" && members.length > 1 && (
              <div>
                <label className="label" htmlFor="ctt-all">Set everyone to</label>
                <select
                  id="ctt-all"
                  className="input"
                  value=""
                  onChange={(e) => {
                    const v = e.target.value === "__none__" ? "" : e.target.value;
                    if (e.target.value) setValues(Object.fromEntries(members.map((m) => [m.id, v])));
                  }}
                >
                  <option value="">Choose…</option>
                  <option value="__none__">No {fieldLabel.toLowerCase()}</option>
                  {tiers.map((t) => <option key={t.name} value={t.name}>{t.name} — {formatCurrency(t.priceCents)}</option>)}
                </select>
              </div>
            )}
            <div className="space-y-2">
              {members.map((m) => (
                <div key={m.id} className={target.type === "group" ? "flex items-center justify-between gap-3" : ""}>
                  <label htmlFor={`ctt-${m.id}`} className={target.type === "group" ? "text-sm text-ink" : "label"}>
                    {target.type === "group" ? m.name : fieldLabel}
                    {m.declined && target.type === "group" && <span className="block text-xs text-ink-faint">Declined — owes $0</span>}
                  </label>
                  <select
                    id={`ctt-${m.id}`}
                    className={`input ${target.type === "group" ? "w-auto max-w-[60%]" : ""}`}
                    value={values[m.id] || ""}
                    onChange={(e) => setValues((v) => ({ ...v, [m.id]: e.target.value }))}
                  >
                    {options(m.tier)}
                  </select>
                </div>
              ))}
            </div>
            {target.type === "invitee" && members[0]?.declined && (
              <p className="text-xs text-ink-faint">This invitee declined, so they owe $0 whatever their ticket type.</p>
            )}
            <p className="text-sm text-ink-soft">
              {target.type === "group" ? "Group total" : "Price"}: {formatCurrency(before)}
              {after !== before && <> → <span className="font-medium text-ink">{formatCurrency(after)}</span></>}
            </p>
          </>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="button" onClick={save} disabled={saving || tiers.length === 0} className="btn-primary">
            {saving ? "Saving…" : changed.length > 1 ? `Save ${changed.length} changes` : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
