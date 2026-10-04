"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { KebabMenu } from "@/components/KebabMenu";
import { ReceivePaymentModal, type PaymentTarget } from "@/components/tickets/ReceivePaymentModal";
import { EditPaymentsModal } from "@/components/tickets/EditPaymentsModal";
import { ChangeTicketTypeModal } from "@/components/tickets/ChangeTicketTypeModal";
import { RefundModal } from "@/components/tickets/RefundModal";
import { ViewToggle } from "@/components/ViewToggle";
import type { TicketingSummary } from "@/lib/models/ticketing";

type View = "individual" | "group";
type Dialog =
  | { kind: "receive"; target?: PaymentTarget } // no target = the top-of-page button: pick who first
  | { kind: "edit"; target: PaymentTarget }
  | { kind: "tier"; target: PaymentTarget }
  | { kind: "refund"; target: PaymentTarget };

type RsvpFilter = "all" | "attending" | "maybe" | "declined" | "no_response";
type PayFilter = "all" | "due" | "paid" | "credit" | "none";
type SortKey = "name" | "balance" | "paid";

const NO_TIER = "__none__";

function rsvpMatches(status: string | null, f: RsvpFilter) {
  if (f === "all") return true;
  if (f === "no_response") return status === null;
  return status === f;
}

/** Same four buckets the Receive-payment picker uses, so the two never describe a row differently. */
function payMatches(owed: number, balance: number, f: PayFilter) {
  if (f === "all") return true;
  if (f === "due") return balance > 0;
  if (f === "credit") return balance < 0;
  if (f === "paid") return owed > 0 && balance === 0;
  return owed === 0 && balance === 0;
}

export function TicketsManager({
  eventId, summary, canMutate,
}: {
  eventId: string;
  summary: TicketingSummary;
  canMutate: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>("individual");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [q, setQ] = useState("");
  const [rsvp, setRsvp] = useState<RsvpFilter>("all");
  const [pay, setPay] = useState<PayFilter>("all");
  const [tier, setTier] = useState("all");
  const [sort, setSort] = useState<SortKey>("name");

  const groupMembers = (groupId: string) =>
    summary.invitees.filter((i) => i.groupId === groupId).map((i) => ({ id: i.inviteeId, name: i.name, tier: i.tier, declined: i.rsvpStatus === "declined" }));

  const filtering = q.trim() !== "" || rsvp !== "all" || pay !== "all" || tier !== "all";
  function clearFilters() { setQ(""); setRsvp("all"); setPay("all"); setTier("all"); }

  const sorter = <T extends { name: string; balanceCents: number; paidCents: number }>(a: T, b: T) =>
    sort === "balance" ? b.balanceCents - a.balanceCents || a.name.localeCompare(b.name)
      : sort === "paid" ? b.paidCents - a.paidCents || a.name.localeCompare(b.name)
        : a.name.localeCompare(b.name);

  const invitees = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return summary.invitees
      .filter((i) => !needle || `${i.name} ${i.groupName || ""}`.toLowerCase().includes(needle))
      .filter((i) => rsvpMatches(i.rsvpStatus, rsvp))
      .filter((i) => payMatches(i.owedCents, i.balanceCents, pay))
      .filter((i) => tier === "all" || (tier === NO_TIER ? !i.tier : i.tier === tier))
      .sort(sorter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, q, rsvp, pay, tier, sort]);

  // A group matches the RSVP / ticket-type filters when any member does; payment status is the group's own.
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return summary.groups
      .filter((g) => !needle || g.name.toLowerCase().includes(needle) || groupMembers(g.groupId).some((m) => m.name.toLowerCase().includes(needle)))
      .filter((g) => rsvp === "all" || g.memberRsvpStatuses.some((s) => rsvpMatches(s, rsvp)))
      .filter((g) => payMatches(g.owedCents, g.balanceCents, pay))
      .filter((g) => tier === "all" || g.tierBreakdown.some((t) => (tier === NO_TIER ? !t.tier : t.tier === tier)))
      .sort(sorter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, q, rsvp, pay, tier, sort]);

  function rowActions(target: PaymentTarget) {
    return (
      <KebabMenu
        label={`Ticket actions for ${target.label}`}
        items={[
          { label: "Edit", onSelect: () => setDialog({ kind: "edit", target }) },
          { label: "Receive payment", onSelect: () => setDialog({ kind: "receive", target }) },
          { label: "Record refund", onSelect: () => setDialog({ kind: "refund", target }) },
          { label: `Change ${summary.fieldLabel?.toLowerCase() || "ticket type"}`, onSelect: () => setDialog({ kind: "tier", target }) },
        ]}
      />
    );
  }

  if (!summary.fieldLabel) {
    return (
      <div className="mt-6 rounded border border-brass-200 bg-brass-50 px-4 py-2.5 text-sm text-brass-600">
        Ticketing is on, but its linked field is missing — everyone shows $0 owed until it&apos;s reconfigured on Overview.
      </div>
    );
  }

  const shown = view === "individual" ? invitees.length : groups.length;
  const total = view === "individual" ? summary.invitees.length : summary.groups.length;
  const balanceClass = (c: number) => (c > 0 ? "text-ink" : c < 0 ? "text-moss-600" : "text-ink-soft");

  return (
    <div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        {summary.hasGroups ? <ViewToggle value={view} onChange={setView} /> : <span />}
        {canMutate && (
          <button onClick={() => setDialog({ kind: "receive" })} className="btn-primary">Receive payment</button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          className="input flex-1 min-w-[180px] max-w-xs"
          placeholder={view === "individual" ? "Search name or group…" : "Search group or member…"}
          aria-label="Search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="input w-auto" aria-label="RSVP status" value={rsvp} onChange={(e) => setRsvp(e.target.value as RsvpFilter)}>
          <option value="all">All statuses</option>
          <option value="attending">Attending</option>
          <option value="maybe">Maybe</option>
          <option value="declined">Declined</option>
          <option value="no_response">No response</option>
        </select>
        <select className="input w-auto" aria-label="Payment status" value={pay} onChange={(e) => setPay(e.target.value as PayFilter)}>
          <option value="all">All payments</option>
          <option value="due">Balance due</option>
          <option value="paid">Paid in full</option>
          <option value="credit">Credit (overpaid)</option>
          <option value="none">Nothing owed</option>
        </select>
        <select className="input w-auto" aria-label={summary.fieldLabel} value={tier} onChange={(e) => setTier(e.target.value)}>
          <option value="all">All {summary.fieldLabel.toLowerCase()}s</option>
          {summary.tiers.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
          <option value={NO_TIER}>No {summary.fieldLabel.toLowerCase()}</option>
        </select>
        <select className="input w-auto" aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="name">Sort: Name (A–Z)</option>
          <option value="balance">Sort: Balance (highest first)</option>
          <option value="paid">Sort: Paid (highest first)</option>
        </select>
        {filtering && (
          <span className="text-sm text-ink-soft">
            Showing {shown} of {total} ·{" "}
            <button onClick={clearFilters} className="font-medium text-wine-500 hover:underline">Clear filters</button>
          </span>
        )}
      </div>

      <div className="mt-4 card overflow-x-auto">
        {view === "individual" ? (
          summary.invitees.length === 0 ? (
            <p className="p-10 text-sm text-ink-faint text-center">No invitees yet.</p>
          ) : invitees.length === 0 ? (
            <p className="p-10 text-sm text-ink-faint text-center">No one matches these filters.</p>
          ) : (
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-paper-line text-left text-ink-faint">
                  <th className="px-5 py-3 font-medium whitespace-nowrap">Name</th>
                  <th className="px-5 py-3 font-medium whitespace-nowrap">Group/Household</th>
                  <th className="px-5 py-3 font-medium whitespace-nowrap">{summary.fieldLabel}</th>
                  <th className="px-5 py-3 font-medium whitespace-nowrap">Owed</th>
                  <th className="px-5 py-3 font-medium whitespace-nowrap">Paid</th>
                  <th className="px-5 py-3 font-medium whitespace-nowrap">Balance</th>
                  {canMutate && <th className="px-3 py-3"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {invitees.map((inv) => (
                  <tr key={inv.inviteeId} className="border-b border-paper-line last:border-0 hover:bg-paper-soft/40">
                    <td className="px-5 py-3 text-ink whitespace-nowrap">{inv.name}</td>
                    <td className="px-5 py-3 text-ink-soft whitespace-nowrap">{inv.groupName || "—"}</td>
                    <td className="px-5 py-3 text-ink-soft whitespace-nowrap">{inv.tier || "—"}</td>
                    <td className="px-5 py-3 text-ink-soft whitespace-nowrap">
                      {formatCurrency(inv.owedCents)}
                      {inv.rsvpStatus === "declined" && <span className="block text-xs text-ink-faint">Declined — no ticket</span>}
                    </td>
                    <td className="px-5 py-3 text-ink-soft whitespace-nowrap">
                      {formatCurrency(inv.paidCents)}
                      {inv.groupShareCents !== 0 && (
                        <span className="block text-xs text-ink-faint">incl. {formatCurrency(inv.groupShareCents)} from group</span>
                      )}
                    </td>
                    <td className={`px-5 py-3 whitespace-nowrap ${balanceClass(inv.balanceCents)}`}>
                      {inv.balanceCents < 0 ? `${formatCurrency(-inv.balanceCents)} credit` : formatCurrency(inv.balanceCents)}
                    </td>
                    {canMutate && (
                      <td className="px-3 py-1.5 text-right whitespace-nowrap w-12">
                        {rowActions({ type: "invitee", id: inv.inviteeId, label: inv.name })}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : summary.groups.length === 0 ? (
          <p className="p-10 text-sm text-ink-faint text-center">No groups yet.</p>
        ) : groups.length === 0 ? (
          <p className="p-10 text-sm text-ink-faint text-center">No groups match these filters.</p>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-paper-line text-left text-ink-faint">
                <th className="px-5 py-3 font-medium whitespace-nowrap">Name</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Group/Household</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">{summary.fieldLabel}</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Owed</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Paid</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Balance</th>
                {canMutate && <th className="px-3 py-3"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.groupId} className="border-b border-paper-line last:border-0 hover:bg-paper-soft/40">
                  <td className="px-5 py-3 text-ink whitespace-nowrap">{g.name}</td>
                  <td className="px-5 py-3 text-ink-soft whitespace-nowrap">{g.memberCount} member{g.memberCount === 1 ? "" : "s"}</td>
                  <td className="px-5 py-3 text-ink-soft whitespace-nowrap">
                    {g.tierBreakdown.map((t) => `${t.tier || "No tier"} x${t.count}`).join(", ") || "—"}
                  </td>
                  <td className="px-5 py-3 text-ink-soft whitespace-nowrap">{formatCurrency(g.owedCents)}</td>
                  <td className="px-5 py-3 text-ink-soft whitespace-nowrap">{formatCurrency(g.paidCents)}</td>
                  <td className={`px-5 py-3 whitespace-nowrap ${balanceClass(g.balanceCents)}`}>
                    {g.balanceCents < 0 ? `${formatCurrency(-g.balanceCents)} credit` : formatCurrency(g.balanceCents)}
                  </td>
                  {canMutate && (
                    <td className="px-3 py-1.5 text-right whitespace-nowrap w-12">
                      {rowActions({ type: "group", id: g.groupId, label: g.name })}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {dialog?.kind === "receive" && (
        <ReceivePaymentModal
          eventId={eventId}
          summary={summary}
          target={dialog.target}
          onClose={() => setDialog(null)}
          onSaved={() => router.refresh()}
        />
      )}
      {dialog?.kind === "edit" && (
        <EditPaymentsModal
          eventId={eventId}
          target={dialog.target}
          members={dialog.target.type === "group" ? groupMembers(dialog.target.id) : []}
          donations={summary.donations}
          onClose={() => setDialog(null)}
          onChanged={() => router.refresh()}
          onReceive={() => setDialog({ kind: "receive", target: dialog.target })}
          onRefund={() => setDialog({ kind: "refund", target: dialog.target })}
        />
      )}
      {dialog?.kind === "refund" && (
        <RefundModal
          eventId={eventId}
          target={dialog.target}
          donationsLabel={summary.donations.label}
          onClose={() => setDialog(null)}
          onSaved={() => router.refresh()}
        />
      )}
      {dialog?.kind === "tier" && (
        <ChangeTicketTypeModal
          eventId={eventId}
          target={dialog.target}
          fieldLabel={summary.fieldLabel || "Ticket type"}
          tiers={summary.tiers}
          members={
            dialog.target.type === "group"
              ? groupMembers(dialog.target.id)
              : summary.invitees.filter((i) => i.inviteeId === dialog.target.id).map((i) => ({ id: i.inviteeId, name: i.name, tier: i.tier, declined: i.rsvpStatus === "declined" }))
          }
          onClose={() => setDialog(null)}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  );
}
