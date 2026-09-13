"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/StatusBadge";
import { AddInviteeModal } from "@/components/invitees/AddInviteeModal";
import { UploadModal } from "@/components/invitees/UploadModal";
import { FieldsManagerModal } from "@/components/invitees/FieldsManagerModal";
import { fullName } from "@/lib/utils";
import type { InviteeFieldType } from "@/lib/models/invitee-fields";

export interface InviteeField {
  id: string;
  key: string;
  label: string;
  kind: "core" | "custom";
  field_type: InviteeFieldType;
  options_json: string | null;
  required: number;
  collect_at_signup: number;
  order_index: number;
  active: number;
}

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
  custom_fields: string | null;
  token: string;
  status: string;
}

function fieldValue(field: InviteeField, i: InviteeRow): string {
  switch (field.key) {
    case "email": return i.email || "—";
    case "phone": return i.phone || "—";
    case "group": return i.group_name || "—";
    case "is_adult": return i.is_adult ? "Adult" : "Child";
    case "plus_one_policy": return i.plus_one_policy || "—";
    case "notes": return i.notes || "—";
    default: {
      const custom = i.custom_fields ? JSON.parse(i.custom_fields) : {};
      return custom[field.key] || "—";
    }
  }
}

export function InviteesManager({ eventId, groupRsvpMode, nameFormat }: { eventId: string; groupRsvpMode: string; nameFormat: "first_last" | "full" }) {
  const router = useRouter();
  const [invitees, setInvitees] = useState<InviteeRow[]>([]);
  const [fields, setFields] = useState<InviteeField[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showFields, setShowFields] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [inviteesRes, fieldsRes] = await Promise.all([
      fetch(`/api/events/${eventId}/invitees`),
      fetch(`/api/events/${eventId}/invitee-fields`),
    ]);
    const inviteesData = await inviteesRes.json();
    const fieldsData = await fieldsRes.json();
    setInvitees(inviteesData.invitees || []);
    setFields((fieldsData.fields || []).filter((f: InviteeField) => f.active).sort((a: InviteeField, b: InviteeField) => a.order_index - b.order_index));
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
        fullName(i.first_name, i.last_name).toLowerCase().includes(q) ||
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
    <div className="p-4 sm:p-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap flex-1 min-w-[240px]">
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
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setShowFields(true)} className="btn-ghost">Manage fields</button>
          <a href={`/api/events/${eventId}/invitees/template`} download className="btn-ghost">Download template</a>
          <button onClick={() => setShowUpload(true)} className="btn-secondary">Upload spreadsheet</button>
          <button onClick={() => setShowAdd(true)} className="btn-primary">+ Add invitee</button>
        </div>
      </div>

      <div className="mt-6 card overflow-x-auto">
        {loading ? (
          <p className="p-8 text-sm text-ink-faint text-center">Loading invitees…</p>
        ) : filtered.length === 0 ? (
          <p className="p-10 text-sm text-ink-faint text-center">
            {invitees.length === 0 ? "No invitees yet. Add someone or upload a spreadsheet to get started." : "No invitees match your search."}
          </p>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-paper-line text-left text-ink-faint">
                <th className="px-5 py-3 font-medium">Name</th>
                {fields.map((f) => (
                  <th key={f.id} className="px-5 py-3 font-medium whitespace-nowrap">{f.label}</th>
                ))}
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">RSVP link</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i.id} className="border-b border-paper-line last:border-0 hover:bg-paper-soft/40">
                  <td className="px-5 py-3">
                    <p className="text-ink">{fullName(i.first_name, i.last_name)}</p>
                  </td>
                  {fields.map((f) => (
                    <td key={f.id} className="px-5 py-3 text-ink-soft whitespace-nowrap">{fieldValue(f, i)}</td>
                  ))}
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
          nameFormat={nameFormat}
          fields={fields}
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
      {showFields && (
        <FieldsManagerModal
          eventId={eventId}
          nameFormat={nameFormat}
          onClose={() => { setShowFields(false); load(); router.refresh(); }}
          onChanged={() => { load(); router.refresh(); }}
        />
      )}
    </div>
  );
}
