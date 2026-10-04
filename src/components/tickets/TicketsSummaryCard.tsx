"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { formatCurrency, formatDateShort } from "@/lib/utils";
import { paymentMethodLabel } from "@/lib/payment-methods";
import type { TicketingTotals, DonationEntry } from "@/lib/models/ticketing";

/** Funds at a glance for the Tickets tab. Ticket figures and donations are separate buckets — a
 * donation never shows up in Collected or reduces Outstanding. */
export function TicketsSummaryCard({
  eventId, clone, totals, donations,
}: {
  eventId: string;
  clone: string | null;
  totals: TicketingTotals;
  donations: { enabled: boolean; label: string };
}) {
  const [showDonations, setShowDonations] = useState(false);
  const showDonationTile = donations.enabled || totals.donationsCents !== 0;

  const tile = "min-w-0 bg-white px-4 py-3";
  const value = "mt-0.5 font-serif text-xl text-ink tabular-nums";
  const caption = "text-xs text-ink-faint";

  return (
    <div className="card overflow-hidden">
      {/* 1px gaps over a line-colored background draw the dividers, whatever the column count. */}
      <div className={`grid grid-cols-2 ${showDonationTile ? "sm:grid-cols-4" : "sm:grid-cols-3"} gap-px bg-paper-line`}>
        <div className={tile}>
          <p className={caption}>Expected</p>
          <p className={value}>{formatCurrency(totals.expectedCents)}</p>
          <p className={caption}>{totals.declinedExcluded > 0 ? `Excludes ${totals.declinedExcluded} declined` : "From ticket types"}</p>
        </div>
        <div className={tile}>
          <p className={caption}>Collected</p>
          <p className={value}>{formatCurrency(totals.collectedCents)}</p>
          <p className={caption}>Ticket payments, net of refunds</p>
        </div>
        <div className={tile}>
          <p className={caption}>Outstanding</p>
          <p className={`${value} ${totals.outstandingCents > 0 ? "text-wine-700" : ""}`}>{formatCurrency(totals.outstandingCents)}</p>
          <p className={caption}>{totals.creditCents > 0 ? `${formatCurrency(totals.creditCents)} in credits` : "Still owed"}</p>
        </div>
        {showDonationTile && (
          <button
            type="button"
            onClick={() => setShowDonations(true)}
            className={`${tile} text-left hover:bg-paper-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-wine-300`}
          >
            <p className={caption}>{donations.label}</p>
            <p className={`${value} text-moss-600`}>{formatCurrency(totals.donationsCents)}</p>
            <p className="text-xs font-medium text-wine-500">View all →</p>
          </button>
        )}
      </div>
      {showDonations && (
        <DonationsModal eventId={eventId} clone={clone} label={donations.label} onClose={() => setShowDonations(false)} />
      )}
    </div>
  );
}

function DonationsModal({ eventId, clone, label, onClose }: { eventId: string; clone: string | null; label: string; onClose: () => void }) {
  const [rows, setRows] = useState<DonationEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/events/${eventId}/donations${clone ? `?clone=${encodeURIComponent(clone)}` : ""}`);
        let data: any = {};
        try { data = await res.json(); } catch {}
        if (!res.ok) return setError(data.error || "We couldn't load these.");
        setRows(data.donations || []);
      } catch {
        setError("We couldn't reach the server just now.");
      }
    })();
  }, [eventId, clone]);

  const net = (rows || []).reduce((sum, r) => sum + (r.kind === "refund" ? -r.donationCents : r.donationCents), 0);
  const sourceLabel = (r: DonationEntry) =>
    r.source === "refund" ? "Refund" : r.source === "direct" ? "Direct gift" : `Extra on a ${formatCurrency(r.totalCents)} payment`;

  return (
    <Modal title={label} onClose={onClose} wide>
      {error ? (
        <p className="text-sm text-clay-600">{error}</p>
      ) : !rows ? (
        <p className="text-sm text-ink-faint">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-faint">Nothing recorded to {label} yet.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-paper-line text-left text-ink-faint">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">From</th>
                  <th className="py-2 pr-3 font-medium">Source</th>
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.paymentId} className="border-b border-paper-line last:border-0 align-top">
                    <td className="py-2 pr-3 whitespace-nowrap text-ink-soft">{r.paidOn ? formatDateShort(r.paidOn) : "—"}</td>
                    <td className="py-2 pr-3 text-ink">
                      {r.who}
                      <span className="text-ink-faint"> · {r.targetType === "group" ? "Group" : "Individual"}</span>
                      {r.note && <span className="block text-xs text-ink-faint">{r.note}</span>}
                    </td>
                    <td className="py-2 pr-3 text-ink-soft">{sourceLabel(r)}</td>
                    <td className="py-2 pr-3 text-ink-soft">{paymentMethodLabel(r.method, r.methodOther)}</td>
                    <td className={`py-2 text-right tabular-nums whitespace-nowrap ${r.kind === "refund" ? "text-clay-600" : "text-ink"}`}>
                      {r.kind === "refund" ? "−" : ""}{formatCurrency(r.donationCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-right text-sm font-medium text-ink">Total: {formatCurrency(net)}</p>
          <p className="mt-2 text-xs text-ink-faint">
            These are kept apart from ticket payments — they never change anyone&apos;s ticket balance. To move one back to tickets, edit
            that payment from the person&apos;s ⋮ menu; to give money back, use Record refund.
          </p>
        </>
      )}
    </Modal>
  );
}
