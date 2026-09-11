"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { EventRow, Role } from "@/lib/models/events";

export function EventActions({ event, status, role }: { event: EventRow; status: string; role: Role }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const canEdit = role === "owner" || role === "admin";

  async function call(path: string, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(path);
    const res = await fetch(`/api/events/${event.id}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    setBusy(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Something went wrong.");
      return;
    }
    router.refresh();
  }

  function copyLink() {
    const url = `${window.location.origin}/e/${event.slug}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      {event.status === "published" && event.visibility !== "invite_only" && (
        <button onClick={copyLink} className="btn-secondary">{copied ? "Link copied!" : "Copy RSVP link"}</button>
      )}
      {canEdit && event.status === "draft" && (
        <button onClick={() => call("/publish")} disabled={busy === "/publish"} className="btn-primary">
          {busy === "/publish" ? "Publishing…" : "Publish event"}
        </button>
      )}
      {canEdit && status === "rsvp_closed" && (
        <button onClick={() => call("/reopen", "Reopen RSVPs after the deadline has passed? This will be noted for your records.")} disabled={busy === "/reopen"} className="btn-secondary">
          Reopen RSVPs
        </button>
      )}
      {canEdit && event.status !== "cancelled" && status !== "completed" && (
        <button
          onClick={() => call("/cancel", "Cancel this event? All invitees with an email on file will be notified.")}
          disabled={busy === "/cancel"}
          className="btn-ghost text-clay-600 hover:bg-clay-500/5"
        >
          Cancel event
        </button>
      )}
      {canEdit && (
        <Link href={`/dashboard/events/${event.id}/settings`} className="btn-ghost">Edit</Link>
      )}
    </div>
  );
}
