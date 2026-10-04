"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { formatCurrency, dollarsToCents } from "@/lib/utils";
import { PAYMENT_METHODS, localToday } from "@/lib/payment-methods";
import type { PaymentTarget } from "@/components/tickets/ReceivePaymentModal";

const errorBox = "rounded border border-clay-500/30 bg-clay-500/5 text-clay-600 text-sm px-3 py-2.5";

/** Records money handed back, out of either ticket payments or the donations bucket — its own dated
 * ledger entry, so both the original payment and the refund stay on record. Capped (here and on the
 * server) at what this invitee/group actually has in that bucket. */
export function RefundModal({
  eventId, target, donationsLabel, onClose, onSaved,
}: {
  eventId: string;
  target: PaymentTarget;
  donationsLabel: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [available, setAvailable] = useState<{ ticketCents: number; donationCents: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bucket, setBucket] = useState<"ticket" | "donation">("ticket");
  const [paidOn, setPaidOn] = useState(localToday());
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [methodOther, setMethodOther] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/events/${eventId}/payments?${target.type === "invitee" ? "inviteeId" : "groupId"}=${target.id}`);
        let data: any = {};
        try { data = await res.json(); } catch {}
        if (!res.ok) return setLoadError(data.error || "We couldn't load this record.");
        setAvailable(data.refundable);
        // Default to whichever bucket actually has money to refund.
        if (data.refundable && data.refundable.ticketCents === 0 && data.refundable.donationCents > 0) setBucket("donation");
      } catch {
        setLoadError("We couldn't reach the server just now.");
      }
    })();
  }, [eventId, target]);

  const cap = available ? (bucket === "donation" ? available.donationCents : available.ticketCents) : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amountCents = dollarsToCents(amount);
    if (!paidOn) return setError("Choose the date of the refund.");
    if (paidOn > localToday()) return setError("The refund date can't be in the future.");
    if (amountCents <= 0) return setError("Enter an amount greater than $0.");
    if (amountCents > cap) return setError(`You can refund at most ${formatCurrency(cap)} from ${bucket === "donation" ? donationsLabel : "ticket payments"}.`);
    if (!method) return setError("Choose how the refund was given.");
    if (method === "other" && !methodOther.trim()) return setError("Describe the refund method for \"Other\".");

    setSaving(true);
    try {
      const res = await fetch(`/api/events/${eventId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "refund", bucket, targetType: target.type, targetId: target.id, amountCents, paidOn, method,
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
    <Modal title={`Record refund — ${target.label}`} onClose={onClose}>
      {loadError ? (
        <p className="text-sm text-clay-600">{loadError}</p>
      ) : !available ? (
        <p className="text-sm text-ink-faint">Loading…</p>
      ) : available.ticketCents === 0 && available.donationCents === 0 ? (
        <div className="space-y-4">
          <p className="text-sm text-ink-soft">There&apos;s nothing to refund — no payments recorded for {target.label} yet.</p>
          <div className="flex justify-end"><button onClick={onClose} className="btn-secondary">Close</button></div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <div className={errorBox}>{error}</div>}
          <fieldset>
            <legend className="label">Refund from</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {([["ticket", "Ticket payments", available.ticketCents], ["donation", donationsLabel, available.donationCents]] as const).map(([v, l, c]) => (
                <label
                  key={v}
                  className={`flex items-center gap-2 rounded border px-3 py-2 text-sm ${c === 0 ? "opacity-50" : "cursor-pointer"} ${bucket === v ? "border-wine-500 bg-wine-50 text-wine-700" : "border-paper-line text-ink-soft"}`}
                >
                  <input type="radio" name="refund-bucket" value={v} checked={bucket === v} disabled={c === 0} onChange={() => setBucket(v)} />
                  <span>{l}<span className="block text-xs text-ink-faint">{formatCurrency(c)} available</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="rf-date">Date refunded</label>
              <input id="rf-date" type="date" className="input" value={paidOn} max={localToday()} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="rf-amount">Amount</label>
              <div className="flex items-center gap-1.5">
                <span className="text-ink-faint text-sm">$</span>
                <input id="rf-amount" type="number" inputMode="decimal" min="0" step="0.01" className="input" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              {cap > 0 && (
                <button type="button" onClick={() => setAmount((cap / 100).toFixed(2))} className="mt-1 text-xs font-medium text-wine-500 hover:underline">
                  Refund all {formatCurrency(cap)}
                </button>
              )}
            </div>
          </div>
          <div>
            <label className="label" htmlFor="rf-method">Refunded by</label>
            <select id="rf-method" className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="">Choose…</option>
              {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          {method === "other" && (
            <div>
              <label className="label" htmlFor="rf-other">Describe refund method</label>
              <input id="rf-other" className="input" value={methodOther} onChange={(e) => setMethodOther(e.target.value)} />
            </div>
          )}
          <div>
            <label className="label" htmlFor="rf-note">Reason <span className="text-ink-faint font-normal">(optional)</span></label>
            <input id="rf-note" className="input" placeholder="e.g. Recorded as a donation by mistake" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving…" : "Record refund"}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
