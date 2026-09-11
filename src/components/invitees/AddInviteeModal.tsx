"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";

export function AddInviteeModal({
  eventId, groupRsvpMode, onClose, onAdded,
}: { eventId: string; groupRsvpMode: string; onClose: () => void; onAdded: () => void }) {
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", phone: "", isAdult: true, groupName: "",
    plusOnePolicy: "" as "" | "none" | "one" | "multiple",
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.firstName || !form.lastName) {
      setError("First and last name are required.");
      return;
    }
    if (!form.email && !form.phone) {
      setError("Add an email or phone number so this invitee can be reached.");
      return;
    }
    setSaving(true);

    let groupId: string | null = null;
    if (form.groupName) {
      const gRes = await fetch(`/api/events/${eventId}/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.groupName }),
      });
      if (gRes.ok) {
        const gData = await gRes.json();
        groupId = gData.group.id;
      }
    }

    const res = await fetch(`/api/events/${eventId}/invitees`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email || undefined,
        phone: form.phone || undefined,
        isAdult: form.isAdult,
        plusOnePolicy: form.plusOnePolicy || null,
        notes: form.notes || undefined,
        groupId,
      }),
    });
    setSaving(false);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Something went wrong.");
      return;
    }
    onAdded();
  }

  return (
    <Modal title="Add invitee" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <div className="rounded border border-clay-500/30 bg-clay-500/5 text-clay-600 text-sm px-3 py-2.5">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">First name</label>
            <input className="input" required value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
          </div>
          <div>
            <label className="label">Last name</label>
            <input className="input" required value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Email</label>
          <input type="email" className="input" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </div>
        {groupRsvpMode !== "individual" && (
          <div>
            <label className="label">Group / household <span className="text-ink-faint font-normal">(optional)</span></label>
            <input className="input" placeholder="e.g. Johnson Family" value={form.groupName} onChange={(e) => set("groupName", e.target.value)} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Adult or child</label>
            <select className="input" value={form.isAdult ? "adult" : "child"} onChange={(e) => set("isAdult", e.target.value === "adult")}>
              <option value="adult">Adult</option>
              <option value="child">Child</option>
            </select>
          </div>
          <div>
            <label className="label">Plus-one policy</label>
            <select className="input" value={form.plusOnePolicy} onChange={(e) => set("plusOnePolicy", e.target.value as any)}>
              <option value="">Use event default</option>
              <option value="none">No plus-ones</option>
              <option value="one">May bring one</option>
              <option value="multiple">May bring multiple</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label">Notes <span className="text-ink-faint font-normal">(optional)</span></label>
          <input className="input" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? "Adding…" : "Add invitee"}</button>
        </div>
      </form>
    </Modal>
  );
}
