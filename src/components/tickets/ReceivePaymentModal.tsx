"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/Modal";
import { formatCurrency, dollarsToCents } from "@/lib/utils";
import { PAYMENT_METHODS, localToday } from "@/lib/payment-methods";
import type { TicketingSummary } from "@/lib/models/ticketing";

export interface PaymentTarget {
  type: "invitee" | "group";
  id: string;
  label: string;
}

const errorBox = "rounded border border-clay-500/30 bg-clay-500/5 text-clay-600 text-sm px-3 py-2.5";

/** Records one payment. Opened from a row's ⋮ menu with `target` already chosen, or from the
 * Tickets tab's top "Receive payment" button with no target — then the planner picks who first. */
export function ReceivePaymentModal({
  eventId, summary, target: initialTarget, onClose, onSaved,
}: {
  eventId: string;
  summary: TicketingSummary;
  target?: PaymentTarget;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [target, setTarget] = useState<PaymentTarget | null>(initialTarget || null);
  const [paidOn, setPaidOn] = useState(localToday());
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [methodOther, setMethodOther] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const balanceCents = target
    ? target.type === "invitee"
      ? summary.invitees.find((i) => i.inviteeId === target.id)?.balanceCents
      : summary.groups.find((g) => g.groupId === target.id)?.balanceCents
    : undefined;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!target) return setError("Choose who this payment is for.");
    if (!paidOn) return setError("Choose the date this payment was received.");
    if (paidOn > localToday()) return setError("The payment date can't be in the future.");
    const amountCents = dollarsToCents(amount);
    if (amountCents <= 0) return setError("Enter an amount greater than $0.");
    if (!method) return setError("Choose a payment type.");
    if (method === "other" && !methodOther.trim()) return setError("Describe the payment type for \"Other\".");

    setSaving(true);
    try {
      const res = await fetch(`/api/events/${eventId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: target.type, targetId: target.id, amountCents, paidOn, method,
          methodOther: method === "other" ? methodOther : undefined, note: note || undefined,
        }),
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

  return (
    <Modal title={target && initialTarget ? `Receive payment — ${target.label}` : "Receive payment"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <div className={errorBox}>{error}</div>}

        {!initialTarget && (
          target ? (
            <div>
              <label className="label">Payment for</label>
              <div className="flex items-center justify-between gap-3 rounded border border-paper-line px-3 py-2">
                <span className="text-sm text-ink">
                  {target.label}
                  <span className="text-ink-faint"> · {target.type === "group" ? "Group" : "Individual"}</span>
                </span>
                <button type="button" onClick={() => setTarget(null)} className="text-xs font-medium text-wine-500 hover:underline">Change</button>
              </div>
            </div>
          ) : (
            <TargetPicker summary={summary} onPick={setTarget} />
          )
        )}

        {target && (
          <>
            {balanceCents !== undefined && (
              <p className="text-sm text-ink-soft">
                Current balance: <span className="font-medium text-ink">{formatCurrency(balanceCents)}</span>
                {balanceCents > 0 && (
                  <button type="button" onClick={() => setAmount((balanceCents / 100).toFixed(2))} className="ml-2 text-xs font-medium text-wine-500 hover:underline">
                    Use full balance
                  </button>
                )}
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="rp-date">Date received</label>
                <input id="rp-date" type="date" className="input" value={paidOn} max={localToday()} onChange={(e) => setPaidOn(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="rp-amount">Amount</label>
                <div className="flex items-center gap-1.5">
                  <span className="text-ink-faint text-sm">$</span>
                  <input id="rp-amount" type="number" inputMode="decimal" min="0" step="0.01" className="input" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="rp-method">Payment type</label>
              <select id="rp-method" className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="">Choose…</option>
                {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            {method === "other" && (
              <div>
                <label className="label" htmlFor="rp-other">Describe payment type</label>
                <input id="rp-other" className="input" placeholder="e.g. Zelle, bank transfer" value={methodOther} onChange={(e) => setMethodOther(e.target.value)} />
              </div>
            )}
            <div>
              <label className="label" htmlFor="rp-note">Note <span className="text-ink-faint font-normal">(optional)</span></label>
              <input id="rp-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving…" : "Record payment"}</button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}

function TargetPicker({ summary, onPick }: { summary: TicketingSummary; onPick: (t: PaymentTarget) => void }) {
  const [kind, setKind] = useState<"invitee" | "group">("invitee");
  const [q, setQ] = useState("");
  const options = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = kind === "invitee"
      ? summary.invitees.map((i) => ({ id: i.inviteeId, label: i.name, sub: i.groupName, balance: i.balanceCents, owed: i.owedCents }))
      : summary.groups.map((g) => ({ id: g.groupId, label: g.name, sub: `${g.memberCount} member${g.memberCount === 1 ? "" : "s"}`, balance: g.balanceCents, owed: g.owedCents }));
    return needle ? list.filter((o) => `${o.label} ${o.sub || ""}`.toLowerCase().includes(needle)) : list;
  }, [kind, q, summary]);

  return (
    <div>
      <label className="label">Who is this payment for?</label>
      {summary.hasGroups && (
        <div className="inline-flex rounded border border-paper-line overflow-hidden text-sm mb-2" role="tablist">
          {(["invitee", "group"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => setKind(k)}
              className={`px-3 py-1.5 ${kind === k ? "bg-wine-50 text-wine-700 font-medium" : "text-ink-soft hover:bg-paper-soft"}`}
            >
              {k === "invitee" ? "Individual" : "Group"}
            </button>
          ))}
        </div>
      )}
      <input className="input" autoFocus placeholder={kind === "invitee" ? "Search invitees…" : "Search groups…"} value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="mt-2 max-h-56 overflow-y-auto rounded border border-paper-line divide-y divide-paper-line">
        {options.length === 0 ? (
          <li className="px-3 py-3 text-sm text-ink-faint">No matches.</li>
        ) : options.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              onClick={() => onPick({ type: kind, id: o.id, label: o.label })}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-paper-soft"
            >
              <span className="min-w-0">
                <span className="text-ink">{o.label}</span>
                {o.sub && <span className="block text-xs text-ink-faint truncate">{o.sub}</span>}
              </span>
              <span className={`shrink-0 tabular-nums ${o.balance > 0 ? "text-ink-soft" : o.owed > 0 ? "text-moss-600" : "text-ink-faint"}`}>
                {o.balance > 0 ? `${formatCurrency(o.balance)} due` : o.owed > 0 ? "Paid" : "Nothing owed"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
