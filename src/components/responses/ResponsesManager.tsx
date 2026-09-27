"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/StatusBadge";
import { fullName, formatDateTime, formatCurrency, cn } from "@/lib/utils";
import { groupCounts } from "@/lib/bulk-select";
import { PaymentModal } from "@/components/responses/PaymentModal";
import type { InviteeResponseRow } from "@/lib/models/rsvp";

interface Ticketing {
  fieldLabel: string | null;
  fieldKey: string | null;
  tierOptions: string[];
  tierByInvitee: Record<string, string>;
  owedByInvitee: Record<string, number>;
  paidByInvitee: Record<string, number>;
  groupOwed: Record<string, number>;
  paidByGroup: Record<string, number>;
  groupNameById: Record<string, string>;
}

interface Question { id: string; label: string; }

const STATUSES = ["attending", "maybe", "declined"] as const;
type Status = (typeof STATUSES)[number];
const STATUS_LABEL: Record<Status, string> = { attending: "Attending", maybe: "Maybe", declined: "Declined" };
const STATUS_ACTIVE_CLASSES: Record<Status, string> = {
  attending: "bg-moss-50 text-moss-600",
  maybe: "bg-wine-500/10 text-wine-600",
  declined: "bg-clay-500/10 text-clay-600",
};

export function ResponsesManager({
  eventId, rows, answersByResponseId, questions, cloneNameById, showCloneColumn, canMutate, ticketing,
}: {
  eventId: string;
  rows: InviteeResponseRow[];
  answersByResponseId: Record<string, { question_id: string; value: string | null }[]>;
  questions: Question[];
  cloneNameById: Record<string, string>;
  showCloneColumn: boolean;
  canMutate: boolean;
  ticketing: Ticketing | null;
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkStatus, setBulkStatus] = useState<Status>("attending");
  const [bulkNumAttending, setBulkNumAttending] = useState("1");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState<{ targetType: "invitee" | "group"; targetId: string; targetLabel: string } | null>(null);
  const [tierBusyId, setTierBusyId] = useState<string | null>(null);

  async function setTier(row: InviteeResponseRow, value: string) {
    if (!ticketing?.fieldKey) return;
    setTierBusyId(row.invitee_id);
    const current = row.custom_fields ? JSON.parse(row.custom_fields) : {};
    await fetch(`/api/events/${eventId}/invitees/${row.invitee_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customFields: { ...current, [ticketing.fieldKey]: value } }),
    });
    setTierBusyId(null);
    router.refresh();
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

  // Groups with anything owed or any group-tagged payment get their own balance line — a lump
  // group payment isn't attributed to any one member's own Paid column (see PaymentModal), so
  // this panel is the only place a household's combined total is shown.
  const groupBalances = useMemo(() => {
    if (!ticketing) return [];
    const groupIds = new Set([...Object.keys(ticketing.groupOwed), ...Object.keys(ticketing.paidByGroup)]);
    return [...groupIds]
      .map((groupId) => {
        const owed = ticketing.groupOwed[groupId] || 0;
        const membersPaid = rows.filter((r) => r.group_id === groupId).reduce((sum, r) => sum + (ticketing.paidByInvitee[r.invitee_id] || 0), 0);
        const paid = (ticketing.paidByGroup[groupId] || 0) + membersPaid;
        return { groupId, name: ticketing.groupNameById[groupId] || "Group", memberCount: rows.filter((r) => r.group_id === groupId).length, owed, paid };
      })
      .filter((g) => g.owed > 0 || g.paid > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [ticketing, rows]);

  return (
    <div>
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

      {ticketing && !ticketing.fieldLabel && (
        <div className="mt-4 rounded border border-brass-200 bg-brass-50 px-4 py-2.5 text-sm text-brass-600">
          Ticketing is on, but its linked field is missing — everyone shows $0 owed until it's reconfigured on Overview.
        </div>
      )}

      {ticketing && groupBalances.length > 0 && (
        <div className="mt-6 card overflow-x-auto">
          <div className="px-5 py-3 border-b border-paper-line">
            <p className="text-sm font-medium text-ink">Group ticket balances</p>
          </div>
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-paper-line text-left text-ink-faint">
                <th className="px-5 py-2.5 font-medium">Group</th>
                <th className="px-5 py-2.5 font-medium">Members</th>
                <th className="px-5 py-2.5 font-medium">Owed</th>
                <th className="px-5 py-2.5 font-medium">Paid</th>
                <th className="px-5 py-2.5 font-medium">Balance</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {groupBalances.map((g) => (
                <tr key={g.groupId} className="border-b border-paper-line last:border-0">
                  <td className="px-5 py-2.5 text-ink">{g.name}</td>
                  <td className="px-5 py-2.5 text-ink-soft">{g.memberCount}</td>
                  <td className="px-5 py-2.5 text-ink-soft">{formatCurrency(g.owed)}</td>
                  <td className="px-5 py-2.5 text-ink-soft">{formatCurrency(g.paid)}</td>
                  <td className="px-5 py-2.5 text-ink-soft">{formatCurrency(g.owed - g.paid)}</td>
                  <td className="px-5 py-2.5 text-right">
                    {canMutate && (
                      <button onClick={() => setPaymentTarget({ targetType: "group", targetId: g.groupId, targetLabel: g.name })} className="text-xs font-medium text-wine-500 hover:underline">
                        Payments
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6 card overflow-x-auto">
        {rows.length === 0 ? (
          <p className="p-10 text-sm text-ink-faint text-center">No invitees yet.</p>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-paper-line text-left text-ink-faint">
                {canMutate && (
                  <th className="px-5 py-3 w-8">
                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="Select all" />
                  </th>
                )}
                <th className="px-5 py-3 font-medium whitespace-nowrap">Name</th>
                {showCloneColumn && <th className="px-5 py-3 font-medium whitespace-nowrap">Clone</th>}
                <th className="px-5 py-3 font-medium whitespace-nowrap">Status</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap"># Attending</th>
                {ticketing && (
                  <>
                    <th className="px-5 py-3 font-medium whitespace-nowrap">{ticketing.fieldLabel || "Tier"}</th>
                    <th className="px-5 py-3 font-medium whitespace-nowrap">Owed</th>
                    <th className="px-5 py-3 font-medium whitespace-nowrap">Paid</th>
                  </>
                )}
                {questions.map((q) => (
                  <th key={q.id} className="px-5 py-3 font-medium whitespace-nowrap">{q.label}</th>
                ))}
                <th className="px-5 py-3 font-medium whitespace-nowrap">Responded</th>
                {ticketing && <th className="px-5 py-3"></th>}
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
                    {ticketing && (
                      <>
                        <td className="px-5 py-3 text-ink-soft whitespace-nowrap">
                          {canMutate && ticketing.fieldKey ? (
                            <select
                              className="input py-1 text-xs"
                              disabled={tierBusyId === r.invitee_id}
                              value={ticketing.tierByInvitee[r.invitee_id] || ""}
                              onChange={(e) => setTier(r, e.target.value)}
                            >
                              <option value="">—</option>
                              {ticketing.tierOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : (
                            ticketing.tierByInvitee[r.invitee_id] || "—"
                          )}
                          {r.group_id && <span className="block text-xs text-ink-faint">part of group balance ↑</span>}
                        </td>
                        <td className="px-5 py-3 text-ink-soft whitespace-nowrap">{formatCurrency(ticketing.owedByInvitee[r.invitee_id] ?? 0)}</td>
                        <td className="px-5 py-3 text-ink-soft whitespace-nowrap">{formatCurrency(ticketing.paidByInvitee[r.invitee_id] ?? 0)}</td>
                      </>
                    )}
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
                    {ticketing && (
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        {canMutate && (
                          <button
                            onClick={() => setPaymentTarget({ targetType: "invitee", targetId: r.invitee_id, targetLabel: fullName(r.first_name, r.last_name) })}
                            className="text-xs font-medium text-wine-500 hover:underline"
                          >
                            Payments
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {paymentTarget && (
        <PaymentModal
          eventId={eventId}
          targetType={paymentTarget.targetType}
          targetId={paymentTarget.targetId}
          targetLabel={paymentTarget.targetLabel}
          onClose={() => setPaymentTarget(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}
