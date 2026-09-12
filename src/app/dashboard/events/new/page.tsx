"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type LocationType = "physical" | "virtual" | "hybrid";

export default function NewEventPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locationType, setLocationType] = useState<LocationType>("physical");
  const [showMore, setShowMore] = useState(false);

  const [form, setForm] = useState({
    name: "", date: "", time: "", endTime: "", description: "",
    venueName: "", address: "", city: "", state: "", zip: "", country: "",
    meetingUrl: "", meetingInstructions: "",
    organizerName: "", organizerContact: "", website: "", dressCode: "", instructions: "",
    rsvpDeadline: "",
    visibility: "invite_only" as "invite_only" | "public" | "hybrid",
    groupRsvpMode: "primary_contact" as "group" | "individual" | "primary_contact",
    defaultPlusOnePolicy: "none" as "none" | "one" | "multiple",
  });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.name || !form.date || !form.time) {
      setError("Event name, date, and time are required.");
      return;
    }
    if (locationType !== "virtual" && !form.venueName && !form.address) {
      setError("Add a venue name or address for the event location.");
      return;
    }
    if (locationType !== "physical" && !form.meetingUrl) {
      setError("Add a meeting link for the virtual portion of this event.");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        locationType,
        rsvpDeadline: form.rsvpDeadline ? new Date(form.rsvpDeadline).toISOString() : undefined,
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error || "Something went wrong.");
      return;
    }
    router.push(`/dashboard/events/${data.event.id}`);
  }

  return (
    <div className="p-4 sm:p-8 max-w-2xl">
      <Link href="/dashboard" className="text-sm text-ink-faint hover:text-ink-soft">← Back to dashboard</Link>
      <h1 className="font-serif text-2xl text-ink mt-3">Create a new event</h1>
      <p className="mt-1.5 text-sm text-ink-soft">Start with the essentials — you can add invitees and RSVP questions after.</p>

      <form onSubmit={onSubmit} className="mt-8 space-y-6">
        {error && <div className="rounded border border-clay-500/30 bg-clay-500/5 text-clay-600 text-sm px-3 py-2.5">{error}</div>}

        <div className="card p-6 space-y-4">
          <p className="text-xs font-medium text-wine-500">Required</p>
          <div>
            <label className="label">Event name</label>
            <input className="input" required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Annual Community Gala" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Date</label>
              <input type="date" className="input" required value={form.date} onChange={(e) => set("date", e.target.value)} />
            </div>
            <div>
              <label className="label">Time</label>
              <input type="time" className="input" required value={form.time} onChange={(e) => set("time", e.target.value)} />
            </div>
          </div>

          <div>
            <label className="label">Location</label>
            <div className="flex gap-2 mb-3 flex-wrap">
              {(["physical", "virtual", "hybrid"] as LocationType[]).map((lt) => (
                <button
                  type="button"
                  key={lt}
                  onClick={() => setLocationType(lt)}
                  className={`chip border ${locationType === lt ? "bg-wine-500 text-paper border-wine-500" : "border-paper-line text-ink-soft"}`}
                >
                  {lt === "physical" ? "In person" : lt === "virtual" ? "Virtual" : "Hybrid"}
                </button>
              ))}
            </div>
            {locationType !== "virtual" && (
              <div className="space-y-3">
                <input className="input" placeholder="Venue name" value={form.venueName} onChange={(e) => set("venueName", e.target.value)} />
                <input className="input" placeholder="Street address" value={form.address} onChange={(e) => set("address", e.target.value)} />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <input className="input" placeholder="City" value={form.city} onChange={(e) => set("city", e.target.value)} />
                  <input className="input" placeholder="State" value={form.state} onChange={(e) => set("state", e.target.value)} />
                  <input className="input" placeholder="ZIP" value={form.zip} onChange={(e) => set("zip", e.target.value)} />
                </div>
              </div>
            )}
            {locationType !== "physical" && (
              <div className="space-y-3 mt-3">
                <input className="input" placeholder="Meeting URL" value={form.meetingUrl} onChange={(e) => set("meetingUrl", e.target.value)} />
                <input className="input" placeholder="Meeting instructions (optional)" value={form.meetingInstructions} onChange={(e) => set("meetingInstructions", e.target.value)} />
              </div>
            )}
          </div>
        </div>

        <button type="button" onClick={() => setShowMore((s) => !s)} className="text-sm text-wine-500 font-medium hover:underline">
          {showMore ? "Hide additional details" : "+ Add description, RSVP deadline & more"}
        </button>

        {showMore && (
          <div className="card p-6 space-y-4">
            <p className="text-xs font-medium text-ink-faint">Recommended</p>
            <div>
              <label className="label">Description</label>
              <textarea className="input min-h-[90px]" value={form.description} onChange={(e) => set("description", e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">End time</label>
                <input type="time" className="input" value={form.endTime} onChange={(e) => set("endTime", e.target.value)} />
              </div>
              <div>
                <label className="label">RSVP deadline</label>
                <input type="datetime-local" className="input" value={form.rsvpDeadline} onChange={(e) => set("rsvpDeadline", e.target.value)} />
                <p className="mt-1 text-xs text-ink-faint">Defaults to 24 hours before the event.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input className="input" placeholder="Organizer name" value={form.organizerName} onChange={(e) => set("organizerName", e.target.value)} />
              <input className="input" placeholder="Organizer contact" value={form.organizerContact} onChange={(e) => set("organizerContact", e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input className="input" placeholder="Website (optional)" value={form.website} onChange={(e) => set("website", e.target.value)} />
              <input className="input" placeholder="Dress code (optional)" value={form.dressCode} onChange={(e) => set("dressCode", e.target.value)} />
            </div>
            <div>
              <label className="label">Additional instructions</label>
              <textarea className="input min-h-[70px]" value={form.instructions} onChange={(e) => set("instructions", e.target.value)} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div>
                <label className="label">Who can RSVP</label>
                <select className="input" value={form.visibility} onChange={(e) => set("visibility", e.target.value as any)}>
                  <option value="invite_only">Invited guests only</option>
                  <option value="public">Anyone with the link</option>
                  <option value="hybrid">Both — invites + open link</option>
                </select>
              </div>
              <div>
                <label className="label">Household RSVPs</label>
                <select className="input" value={form.groupRsvpMode} onChange={(e) => set("groupRsvpMode", e.target.value as any)}>
                  <option value="primary_contact">One person RSVPs for the group</option>
                  <option value="individual">Everyone RSVPs separately</option>
                  <option value="group">Group RSVP (shared response)</option>
                </select>
              </div>
            </div>
            <div>
              <label className="label">Default plus-one policy</label>
              <select className="input" value={form.defaultPlusOnePolicy} onChange={(e) => set("defaultPlusOnePolicy", e.target.value as any)}>
                <option value="none">No plus-ones</option>
                <option value="one">May bring one guest</option>
                <option value="multiple">May bring multiple guests</option>
              </select>
              <p className="mt-1 text-xs text-ink-faint">You can override this for individual invitees later.</p>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? "Creating…" : "Create event"}
          </button>
          <p className="text-xs text-ink-faint">Saved as a draft — you'll publish it when ready.</p>
        </div>
      </form>
    </div>
  );
}
