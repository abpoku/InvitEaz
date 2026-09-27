"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { PaymentModal } from "@/components/tickets/PaymentModal";
import { ViewToggle } from "@/components/ViewToggle";
import type { TicketingSummary } from "@/lib/models/ticketing";

type View = "individual" | "group";

export function TicketsManager({
  eventId, summary, canMutate,
}: {
  eventId: string;
  summary: TicketingSummary;
  canMutate: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>("individual");
  const [paymentTarget, setPaymentTarget] = useState<{ targetType: "invitee" | "group"; targetId: string; targetLabel: string } | null>(null);

  if (!summary.fieldLabel) {
    return (
      <div className="mt-6 rounded border border-brass-200 bg-brass-50 px-4 py-2.5 text-sm text-brass-600">
        Ticketing is on, but its linked field is missing — everyone shows $0 owed until it&apos;s reconfigured on Overview.
      </div>
    );
  }

  return (
    <div>
      {summary.hasGroups && (
        <div className="mt-4">
          <ViewToggle value={view} onChange={setView} />
        </div>
      )}

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
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        <button
                          onClick={() => setPaymentTarget({ targetType: "invitee", targetId: inv.inviteeId, targetLabel: inv.name })}
                          className="text-xs font-medium text-wine-500 hover:underline"
                        >
                          Payments
                        </button>
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
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => setPaymentTarget({ targetType: "group", targetId: g.groupId, targetLabel: g.name })}
                        className="text-xs font-medium text-wine-500 hover:underline"
                      >
                        Payments
                      </button>
                    </td>
                  )}
                </tr>
              ))}
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
