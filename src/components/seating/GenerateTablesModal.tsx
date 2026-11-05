"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { TABLE_SHAPES } from "@/lib/seating";

export interface GenerateSpec { count: number; seats: number; shape: string; prefix: string; assemblyId: string | null; }

/** "Add 12 round tables of 8" in one go — laid out in rows below what's already on the floor and
 * numbered after the existing tables. */
export function GenerateTablesModal({ suggested, clones, onClose, onCreate }: {
  suggested: number;
  clones: { id: string; name: string }[];
  onClose: () => void;
  onCreate: (spec: GenerateSpec) => Promise<string | null>;
}) {
  const [count, setCount] = useState(String(Math.max(1, suggested || 1)));
  const [seats, setSeats] = useState("8");
  const [shape, setShape] = useState("round");
  const [prefix, setPrefix] = useState("Table");
  const [assemblyId, setAssemblyId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const c = Number(count), s = Number(seats);
    if (!(c >= 1 && c <= 100)) return setError("Add between 1 and 100 tables at a time.");
    if (!(s >= 1 && s <= 100)) return setError("Seats per table must be between 1 and 100.");
    setSaving(true);
    const err = await onCreate({ count: c, seats: s, shape, prefix: prefix.trim() || "Table", assemblyId: assemblyId || null });
    setSaving(false);
    if (err) setError(err); else onClose();
  }

  return (
    <Modal title="Add tables" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="rounded border border-clay-500/30 bg-clay-500/5 text-clay-600 text-sm px-3 py-2">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">How many</label>
            <input className="input" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))} autoFocus />
          </div>
          <div>
            <label className="label">Seats each</label>
            <input className="input" inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value.replace(/\D/g, ""))} />
          </div>
          <div>
            <label className="label">Shape</label>
            <select className="input" value={shape} onChange={(e) => { setShape(e.target.value); setSeats(String(TABLE_SHAPES[e.target.value].seats)); }}>
              {Object.entries(TABLE_SHAPES).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Name prefix</label>
            <input className="input" value={prefix} maxLength={40} onChange={(e) => setPrefix(e.target.value)} />
          </div>
        </div>
        {clones.length > 0 && (
          <div>
            <label className="label">Set aside for clone</label>
            <select className="input" value={assemblyId} onChange={(e) => setAssemblyId(e.target.value)}>
              <option value="">No clone</option>
              {clones.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <div className="modal-actions flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? "Adding…" : `Add ${Number(count) || ""} table${Number(count) === 1 ? "" : "s"}`}</button>
        </div>
      </form>
    </Modal>
  );
}
