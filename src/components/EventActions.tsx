"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { EventRow, Role } from "@/lib/models/events";
import { KebabMenu, type KebabItem } from "@/components/KebabMenu";

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

  const reopenMsg = "Reopen RSVPs after the deadline has passed? This will be noted for your records.";
  const cancelMsg = "Cancel this event? All invitees with an email on file will be notified.";
  const canCancel = canEdit && event.status !== "cancelled" && status !== "completed";

  // Phones keep the main button(s) and move Cancel event and Edit into a ⋮ menu — one row instead of
  // two, and the destructive Cancel is no longer one stray tap away.
  const overflow: KebabItem[] = [
    ...(canEdit ? [{ label: "Edit event", onSelect: () => router.push(`/dashboard/events/${event.id}/settings`) }] : []),
    ...(canCancel ? [{ label: "Cancel event", onSelect: () => call("/cancel", cancelMsg) }] : []),
  ];

  return (
    <div className="flex items-center gap-2 sm:flex-wrap sm:shrink-0">
      {event.status === "published" && event.visibility !== "invite_only" && (
        <button onClick={copyLink} className="btn-secondary max-sm:flex-1">{copied ? "Link copied!" : "Copy RSVP link"}</button>
      )}
      {canEdit && event.status === "draft" && (
        <button onClick={() => call("/publish")} disabled={busy === "/publish"} className="btn-primary max-sm:flex-1">
          {busy === "/publish" ? "Publishing…" : "Publish event"}
        </button>
      )}
      {canEdit && status === "rsvp_closed" && (
        <button onClick={() => call("/reopen", reopenMsg)} disabled={busy === "/reopen"} className="btn-secondary max-sm:flex-1">
          Reopen RSVPs
        </button>
      )}
      {canCancel && (
        <button
          onClick={() => call("/cancel", cancelMsg)}
          disabled={busy === "/cancel"}
          className="btn-ghost text-clay-600 hover:bg-clay-500/5 max-sm:hidden"
        >
          Cancel event
        </button>
      )}
      {canEdit && (
        <Link href={`/dashboard/events/${event.id}/settings`} className="btn-ghost max-sm:hidden">Edit</Link>
      )}
      {overflow.length > 0 && (
        <div className="sm:hidden ml-auto">
          <KebabMenu label="More event actions" items={overflow} />
        </div>
      )}
    </div>
  );
}
