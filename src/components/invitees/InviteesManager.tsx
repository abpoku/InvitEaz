"use client";

import { useEffect, useMemo, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { AddInviteeModal } from "@/components/invitees/AddInviteeModal";
import { UploadModal } from "@/components/invitees/UploadModal";

export interface InviteeRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  group_name: string | null;
  group_id: string | null;
  is_adult: number;
  plus_one_policy: string | null;
  notes: string | null;
  token: string;
  status: string;
}

export function InviteesManager({ eventId, groupRsvpMode }: { eventId: string; groupRsvpMode: string }) {
  const [invitees, setInvitees] = useState<InviteeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/events/${eventId}/invitees`);
    const data = await res.json();
    setInvitees(data.invitees || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [eventId]);

  const filtered = useMemo(() => {
    return invitees.filter((i) => {
      if (statusFilter !== "all") {
        if (statusFilter === "no_response" && ["attending", "declined"].includes(i.status)) return false;
        if (statusFilter !== "no_response" && i.status !== statusFilter) return false;
      }
      if (!query) return true;
      const q = query.toLowerCase();
      return (
        `${i.first_name} ${i.last_name}`.toLowerCase().includes(q) ||
        (i.email || "").toLowerCase().includes(q) ||
        (i.group_name || "").toLowerCase().includes(q)
      );
    });
  }, [invitees, query, statusFilter]);

  async function removeInvitee(id: string) {
    if (!confirm("Remove this invitee? Their RSVP history will be preserved for your records.")) return;
    await fetch(`/api/events/${eventId}/invitees/${id}`, { method: "DELETE" });
    load();
  }

  function copyLink(invitee: InviteeRow) {
    const url = `${window.location.origin}/r/${invitee.token}`;
    navigator.clipboard.writeText(url);
    setCopiedId(invitee.id);
    setTimeout(() => setCopiedId(null), 1600);
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-1 min-w-[240px]">
          <input
            className="input max-w-xs"
            placeholder="Search name, email, or group…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select className="input max-w-[180px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="attending">Attending</option>
            <option value="declined">Declined</option>
            <option value="no_response">No response</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <a href="/inviteaz-invitee-template.csv" download className="btn-ghost">Download template</a>
          <button onClick={() => setShowUpload(true)} className="btn-secondary">Upload spreadsheet</button>
          <button onClick={() => setShowAdd(true)} className="btn-primary">+ Add invitee</button>
        </div>
      </div>

      <div className="mt-6 card overflow-hidden">
        {loading ? (
          <p className="p-8 text-sm text-ink-faint text-center">Loading invitees…</p>
        ) : filtered.length === 0 ? (
          <p className="p-10 text-sm text-ink-faint text-center">
            {invitees.length === 0 ? "No invitees yet. Add someone or upload a spreadsheet to get started." : "No invitees match your search."}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-paper-line text-left text-ink-faint">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Contact</th>
                <th className="px-5 py-3 font-medium">Group</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">RSVP link</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i.id} className="border-b border-paper-line last:border-0 hover:bg-paper-soft/40">
                  <td className="px-5 py-3">
                    <p className="text-ink">{i.first_name} {i.last_name}</p>
                    {!i.is_adult && <span className="text-xs text-ink-faint">Child</span>}
                  </td>
                  <td className="px-5 py-3 text-ink-soft">{i.email || i.phone || "—"}</td>
                  <td className="px-5 py-3 text-ink-soft">{i.group_name || "—"}</td>
                  <td className="px-5 py-3"><StatusBadge status={i.status} /></td>
                  <td className="px-5 py-3">
                    <button onClick={() => copyLink(i)} className="text-wine-500 hover:underline text-xs font-medium">
                      {copiedId === i.id ? "Copied!" : "Copy link"}
                    </button>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => removeInvitee(i.id)} className="text-xs text-ink-faint hover:text-clay-600">Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {invitees.length > 0 && (
        <p className="mt-3 text-xs text-ink-faint">{invitees.length} invitee{invitees.length === 1 ? "" : "s"} total.</p>
      )}

      {showAdd && (
        <AddInviteeModal
          eventId={eventId}
          groupRsvpMode={groupRsvpMode}
          onClose={() => setShowAdd(false)}
          onAdded={() => {
            setShowAdd(false);
            load();
          }}
        />
      )}
      {showUpload && (
        <UploadModal
          eventId={eventId}
          onClose={() => setShowUpload(false)}
          onImported={() => {
            setShowUpload(false);
            load();
          }}
        />
      )}
    </div>
  );
}
