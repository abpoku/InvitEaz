"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { formatCurrency, dollarsToCents, formatDateTime } from "@/lib/utils";

interface Payment {
  id: string;
  amount_cents: number;
  note: string | null;
  recorded_by: string;
  recorded_at: string;
}

export function PaymentModal({
  eventId, targetType, targetId, targetLabel, onClose, onChanged,
}: {
  eventId: string;
  targetType: "invitee" | "group";
  targetId: string;
  targetLabel: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newAmount, setNewAmount] = useState("");
  const [newNote, setNewNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editNote, setEditNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const queryKey = targetType === "invitee" ? "inviteeId" : "groupId";

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/events/${eventId}/payments?${queryKey}=${targetId}`);
    if (res.ok) setPayments((await res.json()).payments || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);

  async function addPayment(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amountCents = dollarsToCents(newAmount);
    if (amountCents <= 0) { setError("Enter an amount greater than $0."); return; }
    setAdding(true);
    const res = await fetch(`/api/events/${eventId}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetType, targetId, amountCents, note: newNote || undefined }),
    });
    setAdding(false);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "Something went wrong."); return; }
    setNewAmount("");
    setNewNote("");
    await load();
    onChanged();
  }

  function startEdit(p: Payment) {
    setEditingId(p.id);
    setEditAmount((p.amount_cents / 100).toFixed(2));
    setEditNote(p.note || "");
  }

  async function saveEdit(id: string) {
    setError(null);
    const amountCents = dollarsToCents(editAmount);
    if (amountCents <= 0) { setError("Enter an amount greater than $0."); return; }
    const res = await fetch(`/api/events/${eventId}/payments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountCents, note: editNote || null }),
    });
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "Something went wrong."); return; }
    setEditingId(null);
    await load();
    onChanged();
  }

  async function voidPayment(id: string) {
    if (!confirm("Void this payment? It'll be kept for the record but no longer count toward the balance.")) return;
    await fetch(`/api/events/${eventId}/payments/${id}`, { method: "DELETE" });
    await load();
    onChanged();
  }

  const total = payments.reduce((sum, p) => sum + p.amount_cents, 0);

  return (
    <Modal title={`Payments — ${targetLabel}`} onClose={onClose}>
      {error && <div className="mb-3 rounded border border-clay-500/30 bg-clay-500/5 text-clay-600 text-sm px-3 py-2.5">{error}</div>}

      {loading ? (
        <p className="text-sm text-ink-faint">Loading…</p>
      ) : payments.length === 0 ? (
        <p className="text-sm text-ink-faint">No payments recorded yet.</p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-auto">
          {payments.map((p) => (
            <div key={p.id} className="flex items-start justify-between gap-3 border-b border-paper-line pb-2">
              {editingId === p.id ? (
                <div className="flex-1 space-y-1.5">
                  <div className="flex items-center gap-1">
                    <span className="text-ink-faint text-sm">$</span>
                    <input type="number" min="0" step="0.01" className="input w-24 py-1 text-sm" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
                  </div>
                  <input className="input py-1 text-sm" placeholder="Note (optional)" value={editNote} onChange={(e) => setEditNote(e.target.value)} />
                  <div className="flex gap-2">
                    <button onClick={() => saveEdit(p.id)} className="text-xs font-medium text-wine-500 hover:underline">Save</button>
                    <button onClick={() => setEditingId(null)} className="text-xs text-ink-faint hover:underline">Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink">{formatCurrency(p.amount_cents)}{p.note ? ` — ${p.note}` : ""}</p>
                    <p className="text-xs text-ink-faint">{formatDateTime(p.recorded_at)} · recorded by {p.recorded_by}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button onClick={() => startEdit(p)} className="text-xs text-ink-faint hover:text-ink">Edit</button>
                    <button onClick={() => voidPayment(p.id)} className="text-xs text-ink-faint hover:text-clay-600">Void</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {payments.length > 0 && (
        <p className="mt-3 text-sm text-ink font-medium">Total: {formatCurrency(total)}</p>
      )}

      <form onSubmit={addPayment} className="mt-4 pt-4 border-t border-paper-line flex items-end gap-2 flex-wrap">
        <div>
          <label className="label">Amount</label>
          <div className="flex items-center gap-1">
            <span className="text-ink-faint text-sm">$</span>
            <input type="number" min="0" step="0.01" className="input w-24 py-1 text-sm" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} />
          </div>
        </div>
        <div className="flex-1 min-w-[120px]">
          <label className="label">Note</label>
          <input className="input py-1 text-sm" placeholder="optional" value={newNote} onChange={(e) => setNewNote(e.target.value)} />
        </div>
        <button type="submit" disabled={adding} className="btn-primary shrink-0">{adding ? "Adding…" : "Add payment"}</button>
      </form>
    </Modal>
  );
}
