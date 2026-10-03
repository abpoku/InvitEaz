"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { formatCurrency, dollarsToCents, formatDateShort, formatDateTime } from "@/lib/utils";
import { PAYMENT_METHODS, paymentMethodLabel, localToday } from "@/lib/payment-methods";
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
  allocations: { invitee_id: string; amount_cents: number }[];
}

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
  eventId, target, members, onClose, onChanged, onReceive,
}: {
  eventId: string;
  target: PaymentTarget;
  members: { id: string; name: string }[]; // the group's current members (empty for an invitee)
  onClose: () => void;
  onChanged: () => void;
  onReceive: () => void;
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
  const total = active.reduce((sum, p) => sum + p.amount_cents, 0);
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
                  <EditForm payment={p} onCancel={() => setMode(null)} onSave={async (patch) => done(await send(`/api/events/${eventId}/payments/${p.id}`, "PATCH", patch))} />
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
                        <span className={`font-medium tabular-nums ${p.voided_at ? "line-through" : ""}`}>{formatCurrency(p.amount_cents)}</span>
                        <span className="text-ink-soft"> · {p.paid_on ? formatDateShort(p.paid_on) : "—"} · {paymentMethodLabel(p.method, p.method_other)}</span>
                        {p.voided_at && <span className="ml-2 chip bg-clay-500/10 text-clay-600">Voided</span>}
                      </p>
                      {p.note && <p className="text-sm text-ink-soft">{p.note}</p>}
                      {p.allocations.length > 0 && !p.voided_at && (
                        <p className="mt-1 text-xs text-ink-soft">
                          Split: {p.allocations.map((a) => `${memberName(a.invitee_id)} ${formatCurrency(a.amount_cents)}`).join(", ")}
                          {(() => {
                            const rest = p.amount_cents - p.allocations.reduce((s, a) => s + a.amount_cents, 0);
                            return rest > 0 ? ` · ${formatCurrency(rest)} shared equally` : "";
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
                          {target.type === "group" && members.length > 0 && (
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
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-sm text-ink font-medium">Total received: {formatCurrency(total)}</p>
            <button onClick={onReceive} className="text-sm font-medium text-wine-500 hover:underline">+ Receive payment</button>
          </div>
          <p className="mt-2 text-xs text-ink-faint">Voided payments are kept for the record but don&apos;t count toward any balance.</p>
        </>
      )}
    </Modal>
  );
}

function EditForm({ payment, onCancel, onSave }: { payment: Payment; onCancel: () => void; onSave: (patch: Record<string, unknown>) => void }) {
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
    onSave({
      paidOn, amountCents, note,
      ...(method ? { method, methodOther: method === "other" ? methodOther : null } : {}),
    });
  }

  return (
    <form onSubmit={save} className="space-y-3">
      {error && <div className={errorBox}>{error}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="label">Date received</label>
          <input type="date" className="input" value={paidOn} max={localToday()} onChange={(e) => setPaidOn(e.target.value)} />
        </div>
        <div>
          <label className="label">Amount</label>
          <div className="flex items-center gap-1.5">
            <span className="text-ink-faint text-sm">$</span>
            <input type="number" inputMode="decimal" min="0" step="0.01" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Payment type</label>
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">{payment.method ? "Choose…" : "Not recorded"}</option>
            {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
      </div>
      {method === "other" && (
        <div>
          <label className="label">Describe payment type</label>
          <input className="input" placeholder="e.g. Zelle, bank transfer" value={methodOther} onChange={(e) => setMethodOther(e.target.value)} />
        </div>
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
  members: { id: string; name: string }[];
  onCancel: () => void;
  onSave: (allocations: { inviteeId: string; amountCents: number }[]) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(members.map((m) => {
      const a = payment.allocations.find((x) => x.invitee_id === m.id);
      return [m.id, a ? (a.amount_cents / 100).toFixed(2) : ""];
    }))
  );
  const assigned = members.reduce((sum, m) => sum + Math.max(0, dollarsToCents(values[m.id] || "")), 0);
  const remaining = payment.amount_cents - assigned;
  const over = remaining < 0;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm text-ink font-medium">Split {formatCurrency(payment.amount_cents)} among members</p>
        <p className="text-xs text-ink-faint">Anything you don&apos;t assign is shared equally across the group, as before.</p>
      </div>
      <div className="space-y-2">
        {members.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-3">
            <label htmlFor={`split-${m.id}`} className="text-sm text-ink">{m.name}</label>
            <div className="flex items-center gap-1.5">
              <span className="text-ink-faint text-sm">$</span>
              <input
                id={`split-${m.id}`}
                type="number" inputMode="decimal" min="0" step="0.01"
                className="input w-28 py-1"
                placeholder="0.00"
                value={values[m.id]}
                onChange={(e) => setValues((v) => ({ ...v, [m.id]: e.target.value }))}
              />
            </div>
          </div>
        ))}
      </div>
      <p className={`text-sm ${over ? "text-clay-600" : "text-ink-soft"}`}>
        Assigned {formatCurrency(assigned)} of {formatCurrency(payment.amount_cents)}
        {over ? ` — ${formatCurrency(-remaining)} too much` : remaining > 0 ? ` · ${formatCurrency(remaining)} shared equally` : " · fully assigned"}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        {payment.allocations.length > 0 && (
          <button type="button" onClick={() => onSave([])} className="btn-ghost mr-auto">Clear split</button>
        )}
        <button type="button" onClick={onCancel} className="btn-ghost">Cancel</button>
        <button
          type="button"
          disabled={over}
          onClick={() => onSave(members.map((m) => ({ inviteeId: m.id, amountCents: Math.max(0, dollarsToCents(values[m.id] || "")) })).filter((a) => a.amountCents > 0))}
          className="btn-primary"
        >
          Save split
        </button>
      </div>
    </div>
  );
}
