"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DangerZone({ eventId, eventName }: { eventId: string; eventName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function del() {
    if (!confirm(`Permanently delete "${eventName}"? This removes all invitees, RSVPs, and message history and can't be undone. Consider cancelling the event instead if you want to keep records.`)) return;
    setBusy(true);
    const res = await fetch(`/api/events/${eventId}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/dashboard");
      router.refresh();
    } else {
      setBusy(false);
      alert("Something went wrong.");
    }
  }

  return (
    <div className="card p-6 border-clay-500/20">
      <p className="font-serif text-lg text-clay-600">Danger zone</p>
      <p className="mt-1 text-sm text-ink-soft">Deleting an event is permanent. To preserve RSVP history, cancel the event instead from the actions menu above.</p>
      <button onClick={del} disabled={busy} className="btn-danger mt-4">{busy ? "Deleting…" : "Delete event permanently"}</button>
    </div>
  );
}
