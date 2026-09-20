"use client";

import { useState } from "react";

interface Planner { id: string; email: string | null; invited_email: string; status: string; }

export function ClonePlanners({
  eventId, assemblyId, planners, onChange,
}: { eventId: string; assemblyId: string; planners: Planner[]; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const res = await fetch(`/api/events/${eventId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role: "co_planner", assemblyId }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Something went wrong.");
      return;
    }
    setEmail("");
    setAdding(false);
    onChange();
  }

  async function remove(memberId: string) {
    if (!confirm("Remove this co-planner's access?")) return;
    await fetch(`/api/events/${eventId}/members/${memberId}`, { method: "DELETE" });
    onChange();
  }

  return (
    <div className="mt-3 pt-3 border-t border-paper-line">
      <p className="text-xs text-ink-faint uppercase tracking-wide">Co-planners ({planners.length}/3)</p>
      {error && <div className="mt-2 rounded border border-clay-500/30 bg-clay-500/5 text-clay-600 text-xs px-3 py-2">{error}</div>}
      <div className="mt-2 space-y-1.5">
        {planners.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
            <p className="text-ink-soft">
              <span className="text-ink">{p.email || p.invited_email}</span>
              {p.status === "pending" && <span className="text-ink-faint"> (invited, awaiting sign-up)</span>}
            </p>
            <button onClick={() => remove(p.id)} className="text-xs text-ink-faint hover:text-clay-600 shrink-0">Remove</button>
          </div>
        ))}
        {planners.length === 0 && <p className="text-sm text-ink-faint">No co-planners assigned yet.</p>}
      </div>

      {planners.length < 3 && (
        adding ? (
          <form onSubmit={add} className="mt-2 flex items-center gap-2">
            <input type="email" required className="input py-1" placeholder="co-planner's email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            <button type="submit" disabled={saving} className="btn-secondary text-xs shrink-0">{saving ? "Adding…" : "Invite"}</button>
            <button type="button" onClick={() => setAdding(false)} className="btn-ghost text-xs shrink-0">Cancel</button>
          </form>
        ) : (
          <button onClick={() => setAdding(true)} className="mt-2 text-sm text-wine-500 font-medium hover:underline">+ Add a co-planner</button>
        )
      )}
    </div>
  );
}
