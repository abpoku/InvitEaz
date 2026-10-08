"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { formatCurrency, dollarsToCents, formatDateShort, formatDateTime } from "@/lib/utils";
import { PAYMENT_METHODS, LEGACY_PAYMENT_METHODS, paymentMethodLabel, localToday } from "@/lib/payment-methods";
import type { PaymentTarget } from "@/components/tickets/ReceivePaymentModal";

interface Payment {
  id: string;
  amount_cents: number;
  paid_on: string | null;
  method: string | null;
  method_other: string | null;
  note: string | null;
  recorded_by: string;
  recorded_at: string;
  voided_at: string | null;
  voided_by: string | null;
  kind: "payment" | "refund";
  donation_cents: number;
  allocations: { invitee_id: string; amount_cents: number }[];
}

interface Donations { enabled: boolean; label: string }

const errorBox = "rounded border border-clay-500/30 bg-clay-500/5 text-clay-600 text-sm px-3 py-2.5";

async function send(url: string, method: string, body?: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return null;
    let data: any = {};
    try { data = await res.json(); } catch {}
    return data.error || "Something went wrong. Please try again.";
  } catch {
    return "We couldn't reach the server just now. Please try again.";
  }
}

/** Edit previously recorded payments for one invitee or group: change date/amount/type/note, void,
 * and — for a group payment — split it among specific members instead of sharing it equally. */
export function EditPaymentsModal({
  eventId, target, members, donations, onClose, onChanged, onReceive, onRefund,
}: {
  eventId: string;
  target: PaymentTarget;
  members: { id: string; name: string; owedCents?: number }[]; // the group's current members (empty for an invitee)
  donations: Donations;
  onClose: () => void;
  onChanged: () => void;
  onReceive: () => void;
  onRefund: () => void;
}) {
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<{ kind: "edit" | "split" | "void"; id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoadError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/payments?${target.type === "invitee" ? "inviteeId" : "groupId"}=${target.id}&includeVoided=1`);
      let data: any = {};
      try { data = await res.json(); } catch {}
      if (!res.ok) return setLoadError(data.error || "We couldn't load these payments.");
      setPayments(data.payments || []);
    } catch {
      setLoadError("We couldn't reach the server just now.");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.id]);

  async function done(err: string | null) {
    if (err) return setError(err);
    setError(null);
    setMode(null);
    await load();
    onChanged();
  }

  const active = (payments || []).filter((p) => !p.voided_at);
  const sign = (p: Payment) => (p.kind === "refund" ? -1 : 1);
  const ticketTotal = active.reduce((sum, p) => sum + sign(p) * (p.amount_cents - p.donation_cents), 0);
  const donationTotal = active.reduce((sum, p) => sum + sign(p) * p.donation_cents, 0);
  const memberName = (id: string) => members.find((m) => m.id === id)?.name || "Former member";

  return (
    <Modal title={`Edit payments — ${target.label}`} onClose={onClose} wide>
      {error && <div className={`${errorBox} mb-3`}>{error}</div>}
      {loadError ? (
        <div className="text-sm">
          <p className="text-clay-600">{loadError}</p>
          <button onClick={load} className="mt-3 btn-secondary">Try again</button>
        </div>
      ) : !payments ? (
        <p className="text-sm text-ink-faint">Loading…</p>
      ) : payments.length === 0 ? (
        <div className="text-sm">
          <p className="text-ink-faint">No payments recorded yet.</p>
          <button onClick={onReceive} className="mt-3 btn-secondary">Receive payment</button>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-paper-line border-y border-paper-line">
            {payments.map((p) => (
              <li key={p.id} className="py-3">
                {mode?.id === p.id && mode.kind === "edit" ? (
                  <EditForm payment={p} donations={donations} onCancel={() => setMode(null)} onSave={async (patch) => done(await send(`/api/events/${eventId}/payments/${p.id}`, "PATCH", patch))} />
                ) : mode?.id === p.id && mode.kind === "split" ? (
                  <SplitForm
                    payment={p}
                    members={members}
                    onCancel={() => setMode(null)}
                    onSave={async (allocations) => done(await send(`/api/events/${eventId}/payments/${p.id}/allocations`, "PUT", { allocations }))}
                  />
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className={`min-w-0 ${p.voided_at ? "opacity-60" : ""}`}>
                      <p className="text-sm text-ink">
                        {p.kind === "refund" && <span className="mr-1.5 chip bg-brass-500/10 text-brass-600">Refund</span>}
                        {p.kind === "payment" && p.donation_cents > 0 && p.donation_cents >= p.amount_cents && (
                          <span className="mr-1.5 chip bg-moss-50 text-moss-600">{donations.label}</span>
                        )}
                        <span className={`font-medium tabular-nums ${p.voided_at ? "line-through" : ""}`}>
                          {p.kind === "refund" ? "−" : ""}{formatCurrency(p.amount_cents)}
                        </span>
                        <span className="text-ink-soft"> · {p.paid_on ? formatDateShort(p.paid_on) : "—"} · {paymentMethodLabel(p.method, p.method_other)}</span>
                        {p.voided_at && <span className="ml-2 chip bg-clay-500/10 text-clay-600">Voided</span>}
                      </p>
                      {p.kind === "refund" && (
                        <p className="text-xs text-ink-soft">Refunded from {p.donation_cents > 0 ? donations.label : "ticket payments"}</p>
                      )}
                      {p.kind === "payment" && p.donation_cents > 0 && p.donation_cents < p.amount_cents && (
                        <p className="text-xs text-ink-soft">
                          {formatCurrency(p.amount_cents - p.donation_cents)} to tickets · {formatCurrency(p.donation_cents)} to {donations.label}
                        </p>
                      )}
                      {p.note && <p className="text-sm text-ink-soft">{p.note}</p>}
                      {p.allocations.length > 0 && !p.voided_at && (
                        <p className="mt-1 text-xs text-ink-soft">
                          Split: {p.allocations.map((a) => `${memberName(a.invitee_id)} ${formatCurrency(a.amount_cents)}`).join(", ")}
                          {(() => {
                            const rest = p.amount_cents - p.donation_cents - p.allocations.reduce((s, a) => s + a.amount_cents, 0);
                            return rest > 0 ? ` · ${formatCurrency(rest)} applied to whoever still owes` : "";
                          })()}
                        </p>
                      )}
                      <p className="mt-0.5 text-xs text-ink-faint">
                        Recorded by {p.recorded_by} · {formatDateTime(p.recorded_at)}
                        {p.voided_at && ` · voided by ${p.voided_by} · ${formatDateTime(p.voided_at)}`}
                      </p>
                    </div>
                    {!p.voided_at && (
                      mode?.id === p.id && mode.kind === "void" ? (
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-ink-soft">Void this payment?</span>
                          <button onClick={async () => done(await send(`/api/events/${eventId}/payments/${p.id}`, "DELETE"))} className="font-medium text-clay-600 hover:underline">Yes, void</button>
                          <button onClick={() => setMode(null)} className="text-ink-faint hover:text-ink">Cancel</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 text-xs shrink-0">
                          <button onClick={() => { setError(null); setMode({ kind: "edit", id: p.id }); }} className="text-ink-faint hover:text-ink">Edit</button>
                          {target.type === "group" && members.length > 0 && p.kind === "payment" && p.amount_cents > p.donation_cents && (
                            <button onClick={() => { setError(null); setMode({ kind: "split", id: p.id }); }} className="text-ink-faint hover:text-ink">Split</button>
                          )}
                          <button onClick={() => { setError(null); setMode({ kind: "void", id: p.id }); }} className="text-ink-faint hover:text-clay-600">Void</button>
                        </div>
                      )
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
            <div className="text-sm">
              <p className="text-ink font-medium">Ticket payments: {formatCurrency(ticketTotal)}</p>
              {(donations.enabled || donationTotal !== 0) && (
                <p className="text-ink-soft">{donations.label}: {formatCurrency(donationTotal)}</p>
              )}
            </div>
            <div className="flex items-center gap-4">
              <button onClick={onRefund} className="text-sm font-medium text-ink-soft hover:text-ink">Record refund</button>
              <button onClick={onReceive} className="text-sm font-medium text-wine-500 hover:underline">+ Receive payment</button>
            </div>
          </div>
          <p className="mt-2 text-xs text-ink-faint">Voided payments are kept for the record but don&apos;t count toward any balance.</p>
        </>
      )}
    </Modal>
  );
}

function EditForm({ payment, donations, onCancel, onSave }: { payment: Payment; donations: Donations; onCancel: () => void; onSave: (patch: Record<string, unknown>) => void }) {
  const isRefund = payment.kind === "refund";
  // Only for ordinary payments: how much of it belongs to the donations bucket. Editable whenever the
  // bucket is on, or this payment already has a donation part (so a mistaken one can be moved back).
  const showDonation = !isRefund && (donations.enabled || payment.donation_cents > 0);
  const [donation, setDonation] = useState((payment.donation_cents / 100).toFixed(2));
  const [paidOn, setPaidOn] = useState(payment.paid_on || localToday());
  const [amount, setAmount] = useState((payment.amount_cents / 100).toFixed(2));
  const [method, setMethod] = useState(payment.method || "");
  const [methodOther, setMethodOther] = useState(payment.method_other || "");
  const [note, setNote] = useState(payment.note || "");
  const [error, setError] = useState<string | null>(null);

  function save(e: React.FormEvent) {
    e.preventDefault();
    const amountCents = dollarsToCents(amount);
    if (!paidOn) return setError("Choose the date this payment was received.");
    if (paidOn > localToday()) return setError("The payment date can't be in the future.");
    if (amountCents <= 0) return setError("Enter an amount greater than $0.");
    // Payments recorded before payment types existed have none — editing them doesn't force one.
    if (!method && payment.method) return setError("Choose a payment type.");
    if (method === "other" && !methodOther.trim()) return setError("Describe the payment type for \"Other\".");
    const donationCents = showDonation ? Math.max(0, dollarsToCents(donation)) : undefined;
    if (donationCents !== undefined && donationCents > amountCents) return setError(`The ${donations.label} portion can't be more than the amount.`);
    onSave({
      paidOn, amountCents, note,
      ...(donationCents !== undefined && donationCents !== payment.donation_cents ? { donationCents } : {}),
      ...(method ? { method, methodOther: method === "other" ? methodOther : null } : {}),
    });
  }

  return (
    <form onSubmit={save} className="space-y-3">
      {error && <div className={errorBox}>{error}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="label" htmlFor={`ep-date-${payment.id}`}>Date received</label>
          <input id={`ep-date-${payment.id}`} type="date" className="input" value={paidOn} max={localToday()} onChange={(e) => setPaidOn(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor={`ep-amount-${payment.id}`}>Amount</label>
          <div className="flex items-center gap-1.5">
            <span className="text-ink-faint text-sm">$</span>
            <input id={`ep-amount-${payment.id}`} type="number" inputMode="decimal" min="0" step="0.01" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor={`ep-method-${payment.id}`}>Payment type</label>
          <select id={`ep-method-${payment.id}`} className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">{payment.method ? "Choose…" : "Not recorded"}</option>
            {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            {/* A retired type stays selectable only on a payment that already has it, so it still shows
                as the current value — the planner can switch it to one of the types above. */}
            {LEGACY_PAYMENT_METHODS.filter((m) => m.value === payment.method).map((m) => (
              <option key={m.value} value={m.value}>{m.label} (old)</option>
            ))}
          </select>
          {LEGACY_PAYMENT_METHODS.some((m) => m.value === method) && (
            <p className="mt-1 text-xs text-ink-faint">No longer offered — choose CashApp or Venmo.</p>
          )}
        </div>
      </div>
      {method === "other" && (
        <div>
          <label className="label">Describe payment type</label>
          <input className="input" placeholder="e.g. bank transfer, PayPal" value={methodOther} onChange={(e) => setMethodOther(e.target.value)} />
        </div>
      )}
      {showDonation && (
        <div>
          <label className="label" htmlFor={`ep-donation-${payment.id}`}>Of this, to {donations.label}</label>
          <div className="flex items-center gap-1.5 max-w-[12rem]">
            <span className="text-ink-faint text-sm">$</span>
            <input id={`ep-donation-${payment.id}`} type="number" inputMode="decimal" min="0" step="0.01" className="input" value={donation} onChange={(e) => setDonation(e.target.value)} />
          </div>
          <p className="mt-1 text-xs text-ink-faint">The rest counts toward tickets. Set to 0 to move it all back to tickets.</p>
        </div>
      )}
      {isRefund && (
        <p className="text-xs text-ink-faint">Refunded from {payment.donation_cents > 0 ? donations.label : "ticket payments"}.</p>
      )}
      <div>
        <label className="label">Note <span className="text-ink-faint font-normal">(optional)</span></label>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-ghost">Cancel</button>
        <button type="submit" className="btn-primary">Save changes</button>
      </div>
    </form>
  );
}

function SplitForm({
  payment, members, onCancel, onSave,
}: {
  payment: Payment;
  members: { id: string; name: string; owedCents?: number }[];
  onCancel: () => void;
  onSave: (allocations: { inviteeId: string; amountCents: number }[]) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(members.map((m) => {
      const a = payment.allocations.find((x) => x.invitee_id === m.id);
      return [m.id, a ? (a.amount_cents / 100).toFixed(2) : ""];
    }))
  );
  // Members who owe nothing can't be credited (the server refuses it too); an old split portion on
  // someone who has since declined is dropped here and goes back to whoever still owes.
  const eligible = members.filter((m) => m.owedCents !== 0);
  const assigned = eligible.reduce((sum, m) => sum + Math.max(0, dollarsToCents(values[m.id] || "")), 0);
  const ticketPortion = payment.amount_cents - payment.donation_cents;
  const remaining = ticketPortion - assigned;
  const over = remaining < 0;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm text-ink font-medium">Split {formatCurrency(ticketPortion)} among members</p>
        <p className="text-xs text-ink-faint">Anything you don&apos;t assign is applied to members who still owe, in proportion to what each owes.</p>
      </div>
      <div className="space-y-2">
        {members.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-3">
            <label htmlFor={`split-${m.id}`} className="text-sm text-ink">
              {m.name}
              {m.owedCents === 0 && <span className="block text-xs text-ink-faint">Owes nothing</span>}
            </label>
            <div className="flex items-center gap-1.5">
              <span className="text-ink-faint text-sm">$</span>
              <input
                id={`split-${m.id}`}
                type="number" inputMode="decimal" min="0" step="0.01"
                className="input w-28 py-1 disabled:opacity-50"
                placeholder="0.00"
                disabled={m.owedCents === 0}
                value={values[m.id]}
                onChange={(e) => setValues((v) => ({ ...v, [m.id]: e.target.value }))}
              />
            </div>
          </div>
        ))}
      </div>
      <p className={`text-sm ${over ? "text-clay-600" : "text-ink-soft"}`}>
        Assigned {formatCurrency(assigned)} of {formatCurrency(ticketPortion)}
        {over ? ` — ${formatCurrency(-remaining)} too much` : remaining > 0 ? ` · ${formatCurrency(remaining)} applied to whoever still owes` : " · fully assigned"}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        {payment.allocations.length > 0 && (
          <button type="button" onClick={() => onSave([])} className="btn-ghost mr-auto">Clear split</button>
        )}
        <button type="button" onClick={onCancel} className="btn-ghost">Cancel</button>
        <button
          type="button"
          disabled={over}
          onClick={() => onSave(eligible.map((m) => ({ inviteeId: m.id, amountCents: Math.max(0, dollarsToCents(values[m.id] || "")) })).filter((a) => a.amountCents > 0))}
          className="btn-primary"
        >
          Save split
        </button>
      </div>
    </div>
  );
}
