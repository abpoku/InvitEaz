"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { KebabMenu } from "@/components/KebabMenu";
import { ReceivePaymentModal, type PaymentTarget } from "@/components/tickets/ReceivePaymentModal";
import { EditPaymentsModal } from "@/components/tickets/EditPaymentsModal";
import { ChangeTicketTypeModal } from "@/components/tickets/ChangeTicketTypeModal";
import { ViewToggle } from "@/components/ViewToggle";
import type { TicketingSummary } from "@/lib/models/ticketing";

type View = "individual" | "group";
type Dialog =
  | { kind: "receive"; target?: PaymentTarget } // no target = the top-of-page button: pick who first
  | { kind: "edit"; target: PaymentTarget }
  | { kind: "tier"; target: PaymentTarget };

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

  const groupMembers = (groupId: string) =>
    summary.invitees.filter((i) => i.groupId === groupId).map((i) => ({ id: i.inviteeId, name: i.name, tier: i.tier }));

  function rowActions(target: PaymentTarget) {
    return (
      <KebabMenu
        label={`Ticket actions for ${target.label}`}
        items={[
          { label: "Edit", onSelect: () => setDialog({ kind: "edit", target }) },
          { label: "Receive payment", onSelect: () => setDialog({ kind: "receive", target }) },
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

  return (
    <div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        {summary.hasGroups ? <ViewToggle value={view} onChange={setView} /> : <span />}
        {canMutate && (
          <button onClick={() => setDialog({ kind: "receive" })} className="btn-primary">Receive payment</button>
        )}
      </div>

      <div className="mt-4 card overflow-x-auto">
        {view === "individual" ? (
          summary.invitees.length === 0 ? (
            <p className="p-10 text-sm text-ink-faint text-center">No invitees yet.</p>
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
                  {canMutate && <th className="px-5 py-3"></th>}
                </tr>
              </thead>
              <tbody>
                {summary.invitees.map((inv) => (
                  <tr key={inv.inviteeId} className="border-b border-paper-line last:border-0 hover:bg-paper-soft/40">
                    <td className="px-5 py-3 text-ink whitespace-nowrap">{inv.name}</td>
                    <td className="px-5 py-3 text-ink-soft whitespace-nowrap">{inv.groupName || "—"}</td>
                    <td className="px-5 py-3 text-ink-soft whitespace-nowrap">{inv.tier || "—"}</td>
                    <td className="px-5 py-3 text-ink-soft whitespace-nowrap">{formatCurrency(inv.owedCents)}</td>
                    <td className="px-5 py-3 text-ink-soft whitespace-nowrap">
                      {formatCurrency(inv.paidCents)}
                      {inv.groupShareCents > 0 && (
                        <span className="block text-xs text-ink-faint">incl. {formatCurrency(inv.groupShareCents)} from group</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-ink-soft whitespace-nowrap">{formatCurrency(inv.balanceCents)}</td>
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
                {canMutate && <th className="px-5 py-3"></th>}
              </tr>
            </thead>
            <tbody>
              {summary.groups.map((g) => (
                <tr key={g.groupId} className="border-b border-paper-line last:border-0 hover:bg-paper-soft/40">
                  <td className="px-5 py-3 text-ink whitespace-nowrap">{g.name}</td>
                  <td className="px-5 py-3 text-ink-soft whitespace-nowrap">{g.memberCount} member{g.memberCount === 1 ? "" : "s"}</td>
                  <td className="px-5 py-3 text-ink-soft whitespace-nowrap">
                    {g.tierBreakdown.map((t) => `${t.tier || "No tier"} x${t.count}`).join(", ") || "—"}
                  </td>
                  <td className="px-5 py-3 text-ink-soft whitespace-nowrap">{formatCurrency(g.owedCents)}</td>
                  <td className="px-5 py-3 text-ink-soft whitespace-nowrap">{formatCurrency(g.paidCents)}</td>
                  <td className="px-5 py-3 text-ink-soft whitespace-nowrap">{formatCurrency(g.balanceCents)}</td>
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
          onClose={() => setDialog(null)}
          onChanged={() => router.refresh()}
          onReceive={() => setDialog({ kind: "receive", target: dialog.target })}
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
              : summary.invitees.filter((i) => i.inviteeId === dialog.target.id).map((i) => ({ id: i.inviteeId, name: i.name, tier: i.tier }))
          }
          onClose={() => setDialog(null)}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  );
}
