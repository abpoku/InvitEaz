"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EventRow } from "@/lib/models/events";

export function EventSettingsForm({ event }: { event: EventRow }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: event.name, description: event.description || "",
    event_date: event.event_date, event_time: event.event_time, end_time: event.end_time || "",
    venue_name: event.venue_name || "", address: event.address || "", city: event.city || "", state: event.state || "", zip: event.zip || "",
    meeting_url: event.meeting_url || "",
    organizer_name: event.organizer_name || "", organizer_contact: event.organizer_contact || "",
    instructions: event.instructions || "", dress_code: event.dress_code || "",
    rsvp_deadline: event.rsvp_deadline ? toLocalInput(event.rsvp_deadline) : "",
    visibility: event.visibility,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const body: any = { ...form };
    if (form.rsvp_deadline) body.rsvpDeadline = new Date(form.rsvp_deadline).toISOString();
    delete body.rsvp_deadline;
    const res = await fetch(`/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Something went wrong.");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="card p-6 space-y-4">
      {error && <div className="rounded border border-clay-500/30 bg-clay-500/5 text-clay-600 text-sm px-3 py-2.5">{error}</div>}
      <div>
        <label className="label">Event name</label>
        <input className="input" value={form.name} onChange={(e) => set("name", e.target.value)} />
      </div>
      <div>
        <label className="label">Description</label>
        <textarea className="input min-h-[80px]" value={form.description} onChange={(e) => set("description", e.target.value)} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="label">Date</label>
          <input type="date" className="input" value={form.event_date} onChange={(e) => set("event_date", e.target.value)} />
        </div>
        <div>
          <label className="label">Time</label>
          <input type="time" className="input" value={form.event_time} onChange={(e) => set("event_time", e.target.value)} />
        </div>
        <div>
          <label className="label">End time</label>
          <input type="time" className="input" value={form.end_time} onChange={(e) => set("end_time", e.target.value)} />
        </div>
      </div>
      {event.location_type !== "virtual" && (
        <div className="space-y-3">
          <input className="input" placeholder="Venue name" value={form.venue_name} onChange={(e) => set("venue_name", e.target.value)} />
          <input className="input" placeholder="Address" value={form.address} onChange={(e) => set("address", e.target.value)} />
          <div className="grid grid-cols-3 gap-3">
            <input className="input" placeholder="City" value={form.city} onChange={(e) => set("city", e.target.value)} />
            <input className="input" placeholder="State" value={form.state} onChange={(e) => set("state", e.target.value)} />
            <input className="input" placeholder="ZIP" value={form.zip} onChange={(e) => set("zip", e.target.value)} />
          </div>
        </div>
      )}
      {event.location_type !== "physical" && (
        <input className="input" placeholder="Meeting URL" value={form.meeting_url} onChange={(e) => set("meeting_url", e.target.value)} />
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">RSVP deadline</label>
          <input type="datetime-local" className="input" value={form.rsvp_deadline} onChange={(e) => set("rsvp_deadline", e.target.value)} />
        </div>
        <div>
          <label className="label">Who can RSVP</label>
          <select className="input" value={form.visibility} onChange={(e) => set("visibility", e.target.value as any)}>
            <option value="invite_only">Invited guests only</option>
            <option value="public">Anyone with the link</option>
            <option value="hybrid">Both</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <input className="input" placeholder="Organizer name" value={form.organizer_name} onChange={(e) => set("organizer_name", e.target.value)} />
        <input className="input" placeholder="Organizer contact" value={form.organizer_contact} onChange={(e) => set("organizer_contact", e.target.value)} />
      </div>
      <input className="input" placeholder="Dress code" value={form.dress_code} onChange={(e) => set("dress_code", e.target.value)} />
      <div>
        <label className="label">Instructions</label>
        <textarea className="input min-h-[70px]" value={form.instructions} onChange={(e) => set("instructions", e.target.value)} />
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving…" : "Save changes"}</button>
        {saved && <span className="text-sm text-moss-600">Saved. Attendees will be notified of any material changes.</span>}
      </div>
    </form>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
