"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/StatusBadge";
import { AddInviteeModal } from "@/components/invitees/AddInviteeModal";
import { UploadModal } from "@/components/invitees/UploadModal";
import { FieldsManagerModal } from "@/components/invitees/FieldsManagerModal";
import { BulkEditModal } from "@/components/invitees/BulkEditModal";
import { ViewToggle } from "@/components/ViewToggle";
import { fullName } from "@/lib/utils";
import { groupCounts } from "@/lib/bulk-select";
import type { InviteeFieldType } from "@/lib/models/invitee-fields";

interface GroupRow { id: string; name: string; assembly_id: string | null; rsvp_token: string; }

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

export interface Assembly { id: string; name: string; }

export interface InviteeRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  group_name: string | null;
  group_id: string | null;
  assembly_id: string | null;
  assembly_name: string | null;
  is_adult: number;
  plus_one_policy: string | null;
  notes: string | null;
  custom_fields: string | null;
  token: string;
  status: string;
  added_by_guest: number;
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
  const [assemblies, setAssemblies] = useState<Assembly[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [assemblyFilter, setAssemblyFilter] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<InviteeRow | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showFields, setShowFields] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [ticketFieldId, setTicketFieldId] = useState<string | null>(null);
  const [tierBusyId, setTierBusyId] = useState<string | null>(null);
  const [view, setView] = useState<"individual" | "group">("individual");
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [groupError, setGroupError] = useState<string | null>(null);
  const [groupBusyId, setGroupBusyId] = useState<string | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [groupBulkBusy, setGroupBulkBusy] = useState(false);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());

  function toggleGroupExpanded(groupId: string) {
    setExpandedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [inviteesRes, fieldsRes, assembliesRes, ticketingRes, groupsRes] = await Promise.all([
        fetch(`/api/events/${eventId}/invitees`),
        fetch(`/api/events/${eventId}/invitee-fields`),
        fetch(`/api/events/${eventId}/assemblies`),
        fetch(`/api/events/${eventId}/ticketing`),
        fetch(`/api/events/${eventId}/groups`),
      ]);
      // A 500 has an empty, non-JSON body — never let parsing it throw and strand the page on
      // "Loading invitees…" forever (this happened in production when one request hit a dead DB
      // connection). Invitees and fields are required to render the table, so failing either is
      // shown as an error with a retry; the rest degrade to empty exactly as before.
      const json = async (res: Response) => { try { return await res.json(); } catch { return {}; } };
      if (!inviteesRes.ok || !fieldsRes.ok) {
        setLoadError("We couldn't load your invitees just now.");
        return;
      }
      const inviteesData = await json(inviteesRes);
      const fieldsData = await json(fieldsRes);
      setInvitees(inviteesData.invitees || []);
      setFields((fieldsData.fields || []).filter((f: InviteeField) => f.active).sort((a: InviteeField, b: InviteeField) => a.order_index - b.order_index));
      // 403 for a lead planner (or a network hiccup) just means no assembly filter/picker — not fatal.
      setAssemblies(assembliesRes.ok ? (await json(assembliesRes)).assemblies || [] : []);
      // Same tolerance for ticketing — a lead planner can't reach requireEventRole's "viewer" gate
      // the way this route checks it in every case, and it's a non-fatal, ticketing-only detail.
      setTicketFieldId(ticketingRes.ok ? (await json(ticketingRes)).config?.field?.id ?? null : null);
      setGroups(groupsRes.ok ? (await json(groupsRes)).groups || [] : []);
    } catch {
      // fetch() itself rejects only on a network failure (offline, DNS, connection reset).
      setLoadError("We couldn't reach the server just now.");
    } finally {
      setLoading(false);
    }
  }

  async function setTierValue(invitee: InviteeRow, fieldKey: string, value: string) {
    setTierBusyId(invitee.id);
    const current = invitee.custom_fields ? JSON.parse(invitee.custom_fields) : {};
    await fetch(`/api/events/${eventId}/invitees/${invitee.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customFields: { ...current, [fieldKey]: value } }),
    });
    setTierBusyId(null);
    load();
    router.refresh();
  }

  useEffect(() => {
    load();
  }, [eventId]);

  const filtered = useMemo(() => {
    return invitees.filter((i) => {
      if (statusFilter !== "all") {
        if (statusFilter === "no_response" && ["attending", "declined", "maybe"].includes(i.status)) return false;
        if (statusFilter !== "no_response" && i.status !== statusFilter) return false;
      }
      if (assemblyFilter === "unassigned" && i.assembly_id) return false;
      if (assemblyFilter !== "all" && assemblyFilter !== "unassigned" && i.assembly_id !== assemblyFilter) return false;
      if (!query) return true;
      const q = query.toLowerCase();
      return (
        fullName(i.first_name, i.last_name).toLowerCase().includes(q) ||
        (i.email || "").toLowerCase().includes(q) ||
        (i.group_name || "").toLowerCase().includes(q)
      );
    });
  }, [invitees, query, statusFilter, assemblyFilter]);

  async function removeInvitee(id: string) {
    if (!confirm("Remove this invitee? Their RSVP history will be preserved for your records.")) return;
    await fetch(`/api/events/${eventId}/invitees/${id}`, { method: "DELETE" });
    load();
  }

  /** The household's /g/[token] link — one link that lets anyone in the group RSVP for everyone. */
  function copyGroupLink(group: GroupRow) {
    navigator.clipboard.writeText(`${window.location.origin}/g/${group.rsvp_token}`);
    setCopiedId(group.id);
    setTimeout(() => setCopiedId(null), 1600);
  }

  function copyLink(invitee: InviteeRow) {
    const url = `${window.location.origin}/r/${invitee.token}`;
    navigator.clipboard.writeText(url);
    setCopiedId(invitee.id);
    setTimeout(() => setCopiedId(null), 1600);
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every((i) => selectedIds.has(i.id));
  function toggleSelectAll() {
    setSelectedIds((prev) => {
      if (allFilteredSelected) {
        const next = new Set(prev);
        for (const i of filtered) next.delete(i.id);
        return next;
      }
      return new Set([...prev, ...filtered.map((i) => i.id)]);
    });
  }

  function selectGroup(groupName: string) {
    setSelectedIds((prev) => new Set([...prev, ...filtered.filter((i) => i.group_name === groupName).map((i) => i.id)]));
  }

  async function applyBulkEdit(fieldKey: string, value: string) {
    await fetch(`/api/events/${eventId}/invitees/bulk`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selectedIds], fieldKey, value }),
    });
    setSelectedIds(new Set());
    load();
  }

  async function removeIds(ids: string[]) {
    const count = ids.length;
    if (!confirm(`Remove ${count} invitee${count === 1 ? "" : "s"}? Their RSVP history will be preserved for your records.`)) return;
    await fetch(`/api/events/${eventId}/invitees/bulk`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    setSelectedIds(new Set());
    load();
  }

  const removeSelected = () => removeIds([...selectedIds]);

  const groupOptions = useMemo(() => groupCounts(filtered, (i) => i.group_name), [filtered]);

  // Unfiltered on purpose — a group's member count/eligibility for actions shouldn't change
  // just because the current search/status/clone filter happens to hide its members.
  const groupRows = useMemo(
    () => groups.map((g) => ({ ...g, members: invitees.filter((i) => i.group_id === g.id) })),
    [groups, invitees]
  );

  function bulkEditGroup(groupId: string) {
    const members = groupRows.find((g) => g.id === groupId)?.members || [];
    setSelectedIds(new Set(members.map((m) => m.id)));
    setShowBulkEdit(true);
  }

  function removeGroup(groupId: string) {
    const members = groupRows.find((g) => g.id === groupId)?.members || [];
    if (members.length === 0) return;
    removeIds(members.map((m) => m.id));
  }

  function startRenameGroup(g: GroupRow) {
    setRenamingGroupId(g.id);
    setRenameValue(g.name);
  }

  async function saveRenameGroup(groupId: string) {
    const name = renameValue.trim();
    setRenamingGroupId(null);
    if (!name) return;
    await fetch(`/api/events/${eventId}/groups/${groupId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    load();
  }

  async function deleteGroupRow(groupId: string) {
    if (!confirm("Delete this group? This can't be undone.")) return;
    setGroupBusyId(groupId);
    setGroupError(null);
    const res = await fetch(`/api/events/${eventId}/groups/${groupId}`, { method: "DELETE" });
    let data: any = {};
    try { data = await res.json(); } catch {}
    setGroupBusyId(null);
    if (!res.ok) { setGroupError(data.error || "Couldn't delete this group."); return; }
    load();
  }

  function toggleGroupSelected(id: string) {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allGroupsSelected = groupRows.length > 0 && groupRows.every((g) => selectedGroupIds.has(g.id));
  function toggleSelectAllGroups() {
    setSelectedGroupIds((prev) => {
      if (allGroupsSelected) return new Set();
      return new Set(groupRows.map((g) => g.id));
    });
  }

  function membersOfSelectedGroups() {
    return groupRows.filter((g) => selectedGroupIds.has(g.id)).flatMap((g) => g.members);
  }

  function bulkEditSelectedGroups() {
    setSelectedIds(new Set(membersOfSelectedGroups().map((m) => m.id)));
    setShowBulkEdit(true);
  }

  function removeSelectedGroups() {
    const ids = membersOfSelectedGroups().map((m) => m.id);
    if (ids.length === 0) return;
    setSelectedGroupIds(new Set());
    removeIds(ids);
  }

  async function deleteSelectedGroups() {
    const targets = groupRows.filter((g) => selectedGroupIds.has(g.id));
    const eligible = targets.filter((g) => g.members.length === 0);
    const skipped = targets.length - eligible.length;
    if (eligible.length === 0) {
      setGroupError("None of the selected groups can be deleted — they still have members.");
      return;
    }
    if (!confirm(`Delete ${eligible.length} group${eligible.length === 1 ? "" : "s"}? This can't be undone.`)) return;
    setGroupBulkBusy(true);
    setGroupError(null);
    let deleted = 0;
    let blocked = 0;
    for (const g of eligible) {
      const res = await fetch(`/api/events/${eventId}/groups/${g.id}`, { method: "DELETE" });
      if (res.ok) deleted++;
      else blocked++;
    }
    setGroupBulkBusy(false);
    setSelectedGroupIds(new Set());
    const notes: string[] = [];
    if (skipped > 0) notes.push(`${skipped} skipped (still had members)`);
    if (blocked > 0) notes.push(`${blocked} couldn't be deleted (likely payment history)`);
    if (notes.length > 0) setGroupError(`Deleted ${deleted} group${deleted === 1 ? "" : "s"} — ${notes.join(", ")}.`);
    load();
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
            <option value="maybe">Maybe</option>
            <option value="declined">Declined</option>
            <option value="no_response">No response</option>
          </select>
          {assemblies.length > 0 && (
            <select className="input max-w-[200px]" value={assemblyFilter} onChange={(e) => setAssemblyFilter(e.target.value)}>
              <option value="all">All clones</option>
              <option value="unassigned">Unassigned</option>
              {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setShowFields(true)} className="btn-ghost">Manage fields</button>
          <a href={`/api/events/${eventId}/invitees/template`} download className="btn-ghost">Download template</a>
          <button onClick={() => setShowUpload(true)} className="btn-secondary">Upload spreadsheet</button>
          <button onClick={() => setShowAdd(true)} className="btn-primary">+ Add invitee</button>
        </div>
      </div>

      {(groups.length > 0 || view === "group") && (
        <div className="mt-4">
          <ViewToggle value={view} onChange={setView} />
        </div>
      )}

      {view === "individual" ? (
        <>
          {selectedIds.size > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded border border-wine-200 bg-wine-50 px-4 py-2.5">
              <p className="text-sm text-wine-700">{selectedIds.size} selected</p>
              <div className="flex items-center gap-3 flex-wrap">
                {groupOptions.length > 0 && (
                  <select className="input py-1 text-xs max-w-[200px]" value="" onChange={(e) => e.target.value && selectGroup(e.target.value)}>
                    <option value="">Select all in group…</option>
                    {groupOptions.map((g) => <option key={g.name} value={g.name}>{g.name} ({g.count})</option>)}
                  </select>
                )}
                <button onClick={() => setShowBulkEdit(true)} className="text-sm font-medium text-wine-700 hover:underline">Bulk edit</button>
                <button onClick={removeSelected} className="text-sm font-medium text-clay-600 hover:underline">Remove selected</button>
                <button onClick={() => setSelectedIds(new Set())} className="text-sm font-medium text-wine-700 hover:underline">Clear selection</button>
              </div>
            </div>
          )}

          <div className="mt-6 card overflow-x-auto">
            {loading ? (
              <p className="p-8 text-sm text-ink-faint text-center">Loading invitees…</p>
            ) : loadError ? (
              <div className="p-8 text-sm text-center">
                <p className="text-clay-600">{loadError}</p>
                <button onClick={load} className="mt-3 btn-secondary">Try again</button>
              </div>
            ) : filtered.length === 0 ? (
              <p className="p-10 text-sm text-ink-faint text-center">
                {invitees.length === 0 ? "No invitees yet. Add someone or upload a spreadsheet to get started." : "No invitees match your search."}
              </p>
            ) : (
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-paper-line text-left text-ink-faint">
                    <th className="px-5 py-3 w-8">
                      <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} aria-label="Select all" />
                    </th>
                    <th className="px-5 py-3 font-medium">Name</th>
                    {assemblies.length > 0 && <th className="px-5 py-3 font-medium whitespace-nowrap">Clone</th>}
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
                        <input type="checkbox" checked={selectedIds.has(i.id)} onChange={() => toggleSelected(i.id)} aria-label={`Select ${fullName(i.first_name, i.last_name)}`} />
                      </td>
                      <td className="px-5 py-3">
                        <p className="text-ink">{fullName(i.first_name, i.last_name)}</p>
                      </td>
                      {assemblies.length > 0 && (
                        <td className="px-5 py-3 text-ink-soft whitespace-nowrap">{i.assembly_name || "—"}</td>
                      )}
                      {fields.map((f) => (
                        <td key={f.id} className="px-5 py-3 text-ink-soft whitespace-nowrap">
                          {f.id === ticketFieldId ? (
                            <select
                              className="input py-1 text-xs"
                              disabled={tierBusyId === i.id}
                              value={fieldValue(f, i) === "—" ? "" : fieldValue(f, i)}
                              onChange={(e) => setTierValue(i, f.key, e.target.value)}
                            >
                              <option value="">—</option>
                              {(f.options_json ? JSON.parse(f.options_json) : []).map((o: string) => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : (
                            fieldValue(f, i)
                          )}
                        </td>
                      ))}
                      <td className="px-5 py-3"><StatusBadge status={i.status} /></td>
                      <td className="px-5 py-3">
                        <button onClick={() => copyLink(i)} className="text-wine-500 hover:underline text-xs font-medium">
                          {copiedId === i.id ? "Copied!" : "Copy link"}
                        </button>
                      </td>
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        <button onClick={() => setEditing(i)} className="text-xs text-ink-faint hover:text-ink mr-3">Edit</button>
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
        </>
      ) : (
        <>
          {groupError && (
            <div className="mt-4 rounded border border-clay-500/30 bg-clay-500/5 text-clay-600 text-sm px-4 py-2.5">{groupError}</div>
          )}

          {selectedGroupIds.size > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded border border-wine-200 bg-wine-50 px-4 py-2.5">
              <p className="text-sm text-wine-700">{selectedGroupIds.size} group{selectedGroupIds.size === 1 ? "" : "s"} selected</p>
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={bulkEditSelectedGroups} className="text-sm font-medium text-wine-700 hover:underline">Bulk edit</button>
                <button onClick={removeSelectedGroups} className="text-sm font-medium text-clay-600 hover:underline">Remove selected</button>
                <button onClick={deleteSelectedGroups} disabled={groupBulkBusy} className="text-sm font-medium text-clay-600 hover:underline disabled:opacity-50">
                  {groupBulkBusy ? "Deleting…" : "Delete selected"}
                </button>
                <button onClick={() => setSelectedGroupIds(new Set())} className="text-sm font-medium text-wine-700 hover:underline">Clear selection</button>
              </div>
            </div>
          )}

          <div className="mt-6 card overflow-x-auto">
            {loading ? (
              <p className="p-8 text-sm text-ink-faint text-center">Loading groups…</p>
            ) : groupRows.length === 0 ? (
              <p className="p-10 text-sm text-ink-faint text-center">No groups yet.</p>
            ) : (
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-paper-line text-left text-ink-faint">
                    <th className="px-5 py-3 w-8">
                      <input type="checkbox" checked={allGroupsSelected} onChange={toggleSelectAllGroups} aria-label="Select all groups" />
                    </th>
                    <th className="px-5 py-3 font-medium">Name</th>
                    {assemblies.length > 0 && <th className="px-5 py-3 font-medium whitespace-nowrap">Clone</th>}
                    <th className="px-5 py-3 font-medium whitespace-nowrap">Members</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {groupRows.map((g) => {
                    const expanded = expandedGroupIds.has(g.id);
                    const groupColSpan = 4 + (assemblies.length > 0 ? 1 : 0);
                    return (
                    <Fragment key={g.id}>
                    <tr className="border-b border-paper-line last:border-0 hover:bg-paper-soft/40">
                      <td className="px-5 py-3">
                        <input type="checkbox" checked={selectedGroupIds.has(g.id)} onChange={() => toggleGroupSelected(g.id)} aria-label={`Select ${g.name}`} />
                      </td>
                      <td className="px-5 py-3 text-ink">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleGroupExpanded(g.id)}
                            className="text-ink-faint hover:text-ink w-4 shrink-0"
                            aria-label={expanded ? `Collapse ${g.name}` : `Expand ${g.name}`}
                            disabled={g.members.length === 0}
                          >
                            {g.members.length > 0 ? (expanded ? "▾" : "▸") : ""}
                          </button>
                          {renamingGroupId === g.id ? (
                            <input
                              className="input py-1 text-xs"
                              autoFocus
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onBlur={() => saveRenameGroup(g.id)}
                              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRenamingGroupId(null); }}
                            />
                          ) : (
                            g.name
                          )}
                        </div>
                      </td>
                      {assemblies.length > 0 && (
                        <td className="px-5 py-3 text-ink-soft whitespace-nowrap">
                          {assemblies.find((a) => a.id === g.assembly_id)?.name || "—"}
                        </td>
                      )}
                      <td className="px-5 py-3 text-ink-soft whitespace-nowrap">{g.members.length} member{g.members.length === 1 ? "" : "s"}</td>
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        {g.members.length > 0 && g.rsvp_token && (
                          <button onClick={() => copyGroupLink(g)} className="text-wine-500 hover:underline text-xs font-medium mr-3" title="One link for the whole group to RSVP together">
                            {copiedId === g.id ? "Copied!" : "Copy group link"}
                          </button>
                        )}
                        <button onClick={() => bulkEditGroup(g.id)} disabled={g.members.length === 0} className="text-xs text-ink-faint hover:text-ink mr-3 disabled:opacity-40">Bulk edit</button>
                        <button onClick={() => removeGroup(g.id)} disabled={g.members.length === 0} className="text-xs text-ink-faint hover:text-clay-600 mr-3 disabled:opacity-40">Remove</button>
                        <button onClick={() => startRenameGroup(g)} className="text-xs text-ink-faint hover:text-ink mr-3">Rename</button>
                        {g.members.length === 0 && (
                          <button onClick={() => deleteGroupRow(g.id)} disabled={groupBusyId === g.id} className="text-xs text-clay-600 hover:underline disabled:opacity-40">
                            {groupBusyId === g.id ? "Deleting…" : "Delete"}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expanded && g.members.length > 0 && (
                      <tr className="border-b border-paper-line last:border-0 bg-paper-soft/30">
                        <td colSpan={groupColSpan} className="px-5 py-3">
                          <div className="pl-6 space-y-2">
                            {g.members.map((m) => (
                              <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 text-sm border-b border-paper-line/60 pb-2 last:border-0 last:pb-0">
                                <div className="flex items-center gap-3">
                                  <span className="text-ink">{fullName(m.first_name, m.last_name)}</span>
                                  <StatusBadge status={m.status} />
                                  {!!m.added_by_guest && <span className="chip bg-brass-500/10 text-brass-600">Added by guest</span>}
                                </div>
                                <div className="flex items-center gap-3">
                                  <button onClick={() => copyLink(m)} className="text-wine-500 hover:underline text-xs font-medium">
                                    {copiedId === m.id ? "Copied!" : "Copy link"}
                                  </button>
                                  <button onClick={() => setEditing(m)} className="text-xs text-ink-faint hover:text-ink">Edit</button>
                                  <button onClick={() => removeInvitee(m.id)} className="text-xs text-ink-faint hover:text-clay-600">Remove</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {(showAdd || editing) && (
        <AddInviteeModal
          eventId={eventId}
          groupRsvpMode={groupRsvpMode}
          nameFormat={nameFormat}
          fields={fields}
          assemblies={assemblies}
          invitee={editing || undefined}
          onClose={() => { setShowAdd(false); setEditing(null); }}
          onSaved={() => {
            setShowAdd(false);
            setEditing(null);
            load();
          }}
        />
      )}
      {showUpload && (
        <UploadModal
          eventId={eventId}
          groupRsvpMode={groupRsvpMode}
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
      {showBulkEdit && (
        <BulkEditModal
          fields={fields}
          groupRsvpMode={groupRsvpMode}
          count={selectedIds.size}
          onApply={applyBulkEdit}
          onClose={() => setShowBulkEdit(false)}
        />
      )}
    </div>
  );
}
