"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Member { id: string; role: string; status: string; invited_email: string; first_name: string | null; last_name: string | null; email: string | null; assembly_name: string | null; }

export function CoPlannersPanel({ eventId, members, isOwner }: { eventId: string; members: Member[]; isOwner: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "viewer">("viewer");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const res = await fetch(`/api/events/${eventId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Something went wrong.");
      return;
    }
    setEmail("");
    router.refresh();
  }

  async function remove(memberId: string) {
    if (!confirm("Remove this co-planner's access to the event?")) return;
    await fetch(`/api/events/${eventId}/members/${memberId}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="card p-6">
      <p className="font-serif text-lg text-ink">Co-planners</p>
      <p className="mt-1 text-sm text-ink-soft">Admins can edit everything except billing and deletion. Viewers can see responses and reports only. Lead planners are scoped to one clone — assign them from the Clones section on Overview.</p>

      <div className="mt-4 divide-y divide-paper-line">
        {members.map((m) => (
          <div key={m.id} className="py-2.5 flex items-center justify-between gap-3 text-sm">
            <div className="min-w-0">
              <p className="text-ink truncate">{m.first_name ? `${m.first_name} ${m.last_name}` : m.invited_email}</p>
              <p className="text-xs text-ink-faint truncate">{m.email || m.invited_email} · {m.status === "pending" ? "invited, awaiting sign-up" : "active"}</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="chip bg-ink/[0.06] text-ink-soft capitalize">
                {m.role === "lead_planner" ? `Lead planner${m.assembly_name ? ` · ${m.assembly_name}` : ""}` : m.role}
              </span>
              {isOwner && m.role !== "owner" && (
                <button onClick={() => remove(m.id)} className="text-ink-faint hover:text-clay-600 text-xs">Remove</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {isOwner && (
        <form onSubmit={invite} className="mt-4 flex flex-col sm:flex-row sm:items-end gap-2">
          {error && <p className="text-xs text-clay-600 basis-full">{error}</p>}
          <div className="flex-1">
            <label className="label">Invite by email</label>
            <input type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <select className="input w-full sm:w-32" value={role} onChange={(e) => setRole(e.target.value as any)}>
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
          <button type="submit" disabled={saving} className="btn-secondary shrink-0">{saving ? "Adding…" : "Add"}</button>
        </form>
      )}
    </div>
  );
}
