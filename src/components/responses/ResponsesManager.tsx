"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/StatusBadge";
import { ViewToggle } from "@/components/ViewToggle";
import { fullName, formatDateTime, cn, formatNumber } from "@/lib/utils";
import { groupCounts } from "@/lib/bulk-select";
import { SortTh, useTableSort } from "@/components/SortableHeader";
import { sortRows, statusRank, numericOrText, type SortValue } from "@/lib/table-sort";
import type { InviteeResponseRow } from "@/lib/models/rsvp";

interface Question { id: string; label: string; }

const STATUSES = ["attending", "maybe", "declined"] as const;
type Status = (typeof STATUSES)[number];
const STATUS_LABEL: Record<Status, string> = { attending: "Attending", maybe: "Maybe", declined: "Declined" };
const STATUS_ACTIVE_CLASSES: Record<Status, string> = {
  attending: "bg-moss-50 text-moss-600",
  maybe: "bg-wine-500/10 text-wine-600",
  declined: "bg-clay-500/10 text-clay-600",
};

type StatusFilter = "all" | Status | "no_response";

export function ResponsesManager({
  eventId, rows: allRows, answersByResponseId, questions, cloneNameById, showCloneColumn, canMutate,
}: {
  eventId: string;
  rows: InviteeResponseRow[];
  answersByResponseId: Record<string, { question_id: string; value: string | null }[]>;
  questions: Question[];
  cloneNameById: Record<string, string>;
  showCloneColumn: boolean;
  canMutate: boolean;
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkStatus, setBulkStatus] = useState<Status>("attending");
  const [bulkNumAttending, setBulkNumAttending] = useState("1");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [view, setView] = useState<"individual" | "group">("individual");
  const [groupBusyId, setGroupBusyId] = useState<string | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [groupBulkStatus, setGroupBulkStatus] = useState<Status>("attending");
  const [groupBulkNumAttending, setGroupBulkNumAttending] = useState("1");
  const [groupBulkBusy, setGroupBulkBusy] = useState(false);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, onSort] = useTableSort(
    "inviteaz.sort.responses",
    { key: "name", dir: "asc" },
    ["name", "clone", "status", "attending", "responded", ...questions.map((qq) => `q:${qq.id}`)]
  );
  const [groupSort, onGroupSort] = useTableSort("inviteaz.sort.responses.groups", { key: "name", dir: "asc" }, ["name", "breakdown"]);

  // Everything below (selection, select-all, the table) works off the filtered + sorted rows, so
  // "Select all" only ever selects what's actually on screen.
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const name = (r: InviteeResponseRow) => fullName(r.first_name, r.last_name);
    const filtered = allRows
      .filter((r) => !needle || `${name(r)} ${r.email || ""} ${r.group_name || ""}`.toLowerCase().includes(needle))
      .filter((r) => statusFilter === "all" || (statusFilter === "no_response" ? !r.rsvp_status : r.rsvp_status === statusFilter));
    const answer = (r: InviteeResponseRow, questionId: string) =>
      (r.response_id ? answersByResponseId[r.response_id] : undefined)?.find((a) => a.question_id === questionId)?.value;
    const value = (r: InviteeResponseRow): SortValue => {
      if (sort.key.startsWith("q:")) return numericOrText(answer(r, sort.key.slice(2)));
      switch (sort.key) {
        case "clone": return r.assembly_id ? cloneNameById[r.assembly_id] : null;
        case "status": return statusRank(r.rsvp_status);
        case "attending": return r.rsvp_status === "attending" ? r.num_attending ?? 1 : null;
        case "responded": return r.responded_at;
        default: return name(r);
      }
    };
    return sortRows(filtered, value, sort.dir, name);
  }, [allRows, q, statusFilter, sort, answersByResponseId, cloneNameById]);
  const filtering = q.trim() !== "" || statusFilter !== "all";
  // A bulk action must never touch rows the planner can't currently see.
  useEffect(() => {
    setSelectedIds(new Set());
    setSelectedGroupIds(new Set());
  }, [q, statusFilter]);

  function toggleGroupExpanded(groupId: string) {
    setExpandedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  const selectableRows = useMemo(() => rows.filter((r) => r.invitation_id), [rows]);
  const allSelected = selectableRows.length > 0 && selectableRows.every((r) => selectedIds.has(r.invitation_id!));

  function toggleSelected(invitationId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(invitationId)) next.delete(invitationId);
      else next.add(invitationId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      if (allSelected) {
        const next = new Set(prev);
        for (const r of selectableRows) next.delete(r.invitation_id!);
        return next;
      }
      return new Set([...prev, ...selectableRows.map((r) => r.invitation_id!)]);
    });
  }

  function selectGroup(groupName: string) {
    setSelectedIds((prev) => new Set([...prev, ...selectableRows.filter((r) => r.group_name === groupName).map((r) => r.invitation_id!)]));
  }

  async function setStatus(row: InviteeResponseRow, status: Status, numAttending?: number) {
    if (!row.invitation_id) return;
    setBusyId(row.invitation_id);
    await fetch(`/api/events/${eventId}/responses/${row.invitation_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, numAttending }),
    });
    setBusyId(null);
    router.refresh();
  }

  async function applyBulk() {
    setBulkBusy(true);
    await fetch(`/api/events/${eventId}/responses/bulk`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invitationIds: [...selectedIds],
        status: bulkStatus,
        numAttending: bulkStatus === "attending" ? Number(bulkNumAttending) || 1 : undefined,
      }),
    });
    setBulkBusy(false);
    setSelectedIds(new Set());
    router.refresh();
  }

  const groupOptions = useMemo(() => groupCounts(selectableRows, (r) => r.group_name), [selectableRows]);

  const groupStatusRows = useMemo(() => {
    const map = new Map<string, { groupId: string; name: string; invitationIds: string[]; members: InviteeResponseRow[]; counts: Record<Status | "no_response", number> }>();
    for (const r of allRows) {
      if (!r.group_id) continue;
      const entry = map.get(r.group_id) ?? {
        groupId: r.group_id,
        name: r.group_name || "Group",
        invitationIds: [],
        members: [],
        counts: { attending: 0, maybe: 0, declined: 0, no_response: 0 },
      };
      if (r.invitation_id) entry.invitationIds.push(r.invitation_id);
      entry.members.push(r);
      const status = (r.rsvp_status as Status | null) || "no_response";
      entry.counts[status]++;
      map.set(r.group_id, entry);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [allRows]);

  // Group view: a group shows when any member matches the search/status filter; its counts and
  // member list stay whole, so "Attending 2 · Declined 1" always describes the real household.
  const visibleGroups = useMemo(() => {
    const matching = new Set(rows.map((r) => r.invitee_id));
    const shown = filtering ? groupStatusRows.filter((g) => g.members.some((m) => matching.has(m.invitee_id))) : groupStatusRows;
    // "RSVP breakdown" sorts by how many are attending.
    return sortRows(shown, (g) => (groupSort.key === "breakdown" ? g.counts.attending : g.name), groupSort.dir, (g) => g.name);
  }, [groupStatusRows, rows, filtering, groupSort]);

  async function setGroupStatus(group: { groupId: string; invitationIds: string[] }, status: Status) {
    setGroupBusyId(group.groupId);
    await fetch(`/api/events/${eventId}/responses/bulk`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invitationIds: group.invitationIds, status, numAttending: status === "attending" ? 1 : undefined }),
    });
    setGroupBusyId(null);
    router.refresh();
  }

  function toggleGroupSelected(groupId: string) {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  const allGroupsSelected = visibleGroups.length > 0 && visibleGroups.every((g) => selectedGroupIds.has(g.groupId));
  function toggleSelectAllGroups() {
    setSelectedGroupIds((prev) => (allGroupsSelected ? new Set() : new Set(visibleGroups.map((g) => g.groupId))));
  }

  async function applyGroupBulk() {
    const invitationIds = groupStatusRows.filter((g) => selectedGroupIds.has(g.groupId)).flatMap((g) => g.invitationIds);
    setGroupBulkBusy(true);
    await fetch(`/api/events/${eventId}/responses/bulk`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invitationIds,
        status: groupBulkStatus,
        numAttending: groupBulkStatus === "attending" ? Number(groupBulkNumAttending) || 1 : undefined,
      }),
    });
    setGroupBulkBusy(false);
    setSelectedGroupIds(new Set());
    router.refresh();
  }

  return (
    <div>
      {(groupOptions.length > 0 || groupStatusRows.length > 0 || view === "group") && (
        <div className="mt-4">
          <ViewToggle value={view} onChange={setView} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          className="input flex-1 min-w-[180px] max-w-xs"
          placeholder="Search name, email, or group…"
          aria-label="Search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="input w-auto" aria-label="RSVP status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
          <option value="all">All statuses</option>
          <option value="attending">Attending</option>
          <option value="maybe">Maybe</option>
          <option value="declined">Declined</option>
          <option value="no_response">No response</option>
        </select>
        {filtering && (
          <span className="text-sm text-ink-soft">
            Showing {formatNumber(view === "individual" ? rows.length : visibleGroups.length)} of {formatNumber(view === "individual" ? allRows.length : groupStatusRows.length)} ·{" "}
            <button onClick={() => { setQ(""); setStatusFilter("all"); }} className="font-medium text-wine-500 hover:underline">Clear filters</button>
          </span>
        )}
      </div>

      {view === "group" ? (
        <>
          {canMutate && selectedGroupIds.size > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded border border-wine-200 bg-wine-50 px-4 py-2.5">
              <p className="text-sm text-wine-700">{selectedGroupIds.size} group{selectedGroupIds.size === 1 ? "" : "s"} selected</p>
              <div className="flex items-center gap-3 flex-wrap">
                <select className="input py-1 text-xs" value={groupBulkStatus} onChange={(e) => setGroupBulkStatus(e.target.value as Status)}>
                  {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
                {groupBulkStatus === "attending" && (
                  <input
                    type="number" min={1} className="input py-1 text-xs w-16"
                    value={groupBulkNumAttending} onChange={(e) => setGroupBulkNumAttending(e.target.value)}
                    aria-label="Party size"
                  />
                )}
                <button onClick={applyGroupBulk} disabled={groupBulkBusy} className="text-sm font-medium text-wine-700 hover:underline">
                  {groupBulkBusy ? "Applying…" : `Apply to ${selectedGroupIds.size} group${selectedGroupIds.size === 1 ? "" : "s"}`}
                </button>
                <button onClick={() => setSelectedGroupIds(new Set())} className="text-sm font-medium text-wine-700 hover:underline">Clear selection</button>
              </div>
            </div>
          )}

          <div className="mt-6 card overflow-x-auto">
          {visibleGroups.length === 0 ? (
            <p className="p-10 text-sm text-ink-faint text-center">{groupStatusRows.length === 0 ? "No groups yet." : "No groups match your filters."}</p>
          ) : (
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-paper-line text-left text-ink-faint">
                  {canMutate && (
                    <th className="px-5 py-3 w-8">
                      <input type="checkbox" checked={allGroupsSelected} onChange={toggleSelectAllGroups} aria-label="Select all groups" />
                    </th>
                  )}
                  <SortTh label="Name" column="name" sort={groupSort} onSort={onGroupSort} />
                  <SortTh label="RSVP breakdown" column="breakdown" sort={groupSort} onSort={onGroupSort} firstDir="desc" />
                  {canMutate && <th className="px-5 py-3 font-medium whitespace-nowrap">Set status for group</th>}
                </tr>
              </thead>
              <tbody>
                {visibleGroups.map((g) => {
                  const expanded = expandedGroupIds.has(g.groupId);
                  const groupColSpan = 2 + (canMutate ? 2 : 0);
                  return (
                  <Fragment key={g.groupId}>
                  <tr className="border-b border-paper-line last:border-0 hover:bg-paper-soft/40">
                    {canMutate && (
                      <td className="px-5 py-3">
                        <input type="checkbox" checked={selectedGroupIds.has(g.groupId)} onChange={() => toggleGroupSelected(g.groupId)} aria-label={`Select ${g.name}`} />
                      </td>
                    )}
                    <td className="px-5 py-3 text-ink whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleGroupExpanded(g.groupId)}
                          className="text-ink-faint hover:text-ink w-4 shrink-0"
                          aria-label={expanded ? `Collapse ${g.name}` : `Expand ${g.name}`}
                        >
                          {expanded ? "▾" : "▸"}
                        </button>
                        {g.name}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-ink-soft whitespace-nowrap">
                      <span className="text-moss-600">{formatNumber(g.counts.attending)} attending</span> · {formatNumber(g.counts.maybe)} maybe · <span className="text-wine-700">{formatNumber(g.counts.declined)} declined</span> · {formatNumber(g.counts.no_response)} no response
                    </td>
                    {canMutate && (
                      <td className="px-5 py-3">
                        <div className="inline-flex rounded border border-paper-line overflow-hidden text-xs">
                          {STATUSES.map((s) => (
                            <button
                              key={s}
                              disabled={groupBusyId === g.groupId}
                              onClick={() => setGroupStatus(g, s)}
                              className="px-2 py-1 disabled:opacity-50 text-ink-faint hover:bg-paper-soft"
                            >
                              {STATUS_LABEL[s]}
                            </button>
                          ))}
                        </div>
                      </td>
                    )}
                  </tr>
                  {expanded && (
                    <tr className="border-b border-paper-line last:border-0 bg-paper-soft/30">
                      <td colSpan={groupColSpan} className="px-5 py-3">
                        <div className="pl-6 space-y-2">
                          {g.members.map((r) => {
                            const currentStatus = r.rsvp_status as Status | null;
                            const isBusy = busyId === r.invitation_id;
                            return (
                              <div key={r.invitee_id} className="flex flex-wrap items-center justify-between gap-3 text-sm border-b border-paper-line/60 pb-2 last:border-0 last:pb-0">
                                <span className="text-ink">{fullName(r.first_name, r.last_name)}</span>
                                <div className="flex items-center gap-3">
                                  {currentStatus === "attending" && canMutate && r.invitation_id && (
                                    <input
                                      type="number" min={1} className="input w-16 py-1 text-xs"
                                      defaultValue={r.num_attending ?? 1}
                                      onBlur={(e) => setStatus(r, "attending", Number(e.target.value) || 1)}
                                    />
                                  )}
                                  {canMutate && r.invitation_id ? (
                                    <div className="inline-flex rounded border border-paper-line overflow-hidden text-xs">
                                      {STATUSES.map((s) => (
                                        <button
                                          key={s}
                                          disabled={isBusy}
                                          onClick={() => setStatus(r, s)}
                                          className={cn(
                                            "px-2 py-1 disabled:opacity-50",
                                            currentStatus === s ? STATUS_ACTIVE_CLASSES[s] : "text-ink-faint hover:bg-paper-soft"
                                          )}
                                        >
                                          {STATUS_LABEL[s]}
                                        </button>
                                      ))}
                                    </div>
                                  ) : (
                                    <StatusBadge status={currentStatus || "no_response"} />
                                  )}
                                </div>
                              </div>
                            );
                          })}
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
      ) : (
        <>
      {canMutate && selectedIds.size > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded border border-wine-200 bg-wine-50 px-4 py-2.5">
          <p className="text-sm text-wine-700">{selectedIds.size} selected</p>
          <div className="flex items-center gap-3 flex-wrap">
            {groupOptions.length > 0 && (
              <select className="input py-1 text-xs max-w-[200px]" value="" onChange={(e) => e.target.value && selectGroup(e.target.value)}>
                <option value="">Select all in group…</option>
                {groupOptions.map((g) => <option key={g.name} value={g.name}>{g.name} ({g.count})</option>)}
              </select>
            )}
            <select className="input py-1 text-xs" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value as Status)}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
            {bulkStatus === "attending" && (
              <input
                type="number" min={1} className="input py-1 text-xs w-16"
                value={bulkNumAttending} onChange={(e) => setBulkNumAttending(e.target.value)}
                aria-label="Party size"
              />
            )}
            <button onClick={applyBulk} disabled={bulkBusy} className="text-sm font-medium text-wine-700 hover:underline">
              {bulkBusy ? "Applying…" : `Apply to ${selectedIds.size}`}
            </button>
            <button onClick={() => setSelectedIds(new Set())} className="text-sm font-medium text-wine-700 hover:underline">Clear selection</button>
          </div>
        </div>
      )}

      <div className="mt-6 card overflow-x-auto">
        {rows.length === 0 ? (
          <p className="p-10 text-sm text-ink-faint text-center">{allRows.length === 0 ? "No invitees yet." : "No one matches your filters."}</p>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-paper-line text-left text-ink-faint">
                {canMutate && (
                  <th className="px-5 py-3 w-8">
                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="Select all" />
                  </th>
                )}
                <SortTh label="Name" column="name" sort={sort} onSort={onSort} />
                {showCloneColumn && <SortTh label="Clone" column="clone" sort={sort} onSort={onSort} />}
                <SortTh label="Status" column="status" sort={sort} onSort={onSort} />
                <SortTh label="# Attending" column="attending" sort={sort} onSort={onSort} firstDir="desc" />
                {questions.map((q) => (
                  <SortTh key={q.id} label={q.label} column={`q:${q.id}`} sort={sort} onSort={onSort} />
                ))}
                <SortTh label="Responded" column="responded" sort={sort} onSort={onSort} firstDir="desc" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const answers = new Map((r.response_id ? answersByResponseId[r.response_id] : undefined)?.map((a) => [a.question_id, a.value]) || []);
                const currentStatus = r.rsvp_status as Status | null;
                const isBusy = busyId === r.invitation_id;
                return (
                  <tr key={r.invitee_id} className="border-b border-paper-line last:border-0 hover:bg-paper-soft/40">
                    {canMutate && (
                      <td className="px-5 py-3">
                        {r.invitation_id && (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(r.invitation_id)}
                            onChange={() => toggleSelected(r.invitation_id!)}
                            aria-label={`Select ${fullName(r.first_name, r.last_name)}`}
                          />
                        )}
                      </td>
                    )}
                    <td className="px-5 py-3 text-ink whitespace-nowrap">{fullName(r.first_name, r.last_name)}</td>
                    {showCloneColumn && (
                      <td className="px-5 py-3 text-ink-soft whitespace-nowrap">{r.assembly_id ? cloneNameById[r.assembly_id] || "—" : "Unassigned"}</td>
                    )}
                    <td className="px-5 py-3">
                      {canMutate && r.invitation_id ? (
                        <div className="inline-flex rounded border border-paper-line overflow-hidden text-xs">
                          {STATUSES.map((s) => (
                            <button
                              key={s}
                              disabled={isBusy}
                              onClick={() => setStatus(r, s)}
                              className={cn(
                                "px-2 py-1 disabled:opacity-50",
                                currentStatus === s ? STATUS_ACTIVE_CLASSES[s] : "text-ink-faint hover:bg-paper-soft"
                              )}
                            >
                              {STATUS_LABEL[s]}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <StatusBadge status={currentStatus || "no_response"} />
                      )}
                    </td>
                    <td className="px-5 py-3 text-ink-soft">
                      {currentStatus === "attending" ? (
                        canMutate && r.invitation_id ? (
                          <input
                            type="number" min={1} className="input w-16 py-1 text-xs"
                            defaultValue={r.num_attending ?? 1}
                            onBlur={(e) => setStatus(r, "attending", Number(e.target.value) || 1)}
                          />
                        ) : (r.num_attending ?? 1)
                      ) : "—"}
                    </td>
                    {questions.map((q) => (
                      <td key={q.id} className="px-5 py-3 text-ink-soft whitespace-nowrap">{answers.get(q.id) || "—"}</td>
                    ))}
                    <td className="px-5 py-3 text-ink-faint whitespace-nowrap">
                      {r.responded_at ? (
                        <>
                          {formatDateTime(r.responded_at)}
                          {r.is_modification ? " (edited)" : ""}
                          {r.recorded_by ? ` · marked by ${r.recorded_by}` : ""}
                        </>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
        </>
      )}
    </div>
  );
}
