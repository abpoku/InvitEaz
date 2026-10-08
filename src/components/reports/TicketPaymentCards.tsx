import Link from "next/link";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { ticketBreakdown } from "@/lib/report-tickets";
import type { TicketingSummary, CollectedEntry, DonationEntry } from "@/lib/models/ticketing";

const OWED = "text-wine-700";
const PAID = "text-moss-600";

/** Reports-tab view of ticket money. Every figure comes from the same sources as the Tickets tab —
 * totals from getTicketingSummary, the method breakdown from listCollected/listDonations (the lists
 * behind its Collected and Donations tiles) — so the two tabs always agree. */
export function TicketPaymentCards({
  eventId, summary, collected, donations,
}: {
  eventId: string;
  summary: TicketingSummary;
  collected: CollectedEntry[];
  donations: DonationEntry[];
}) {
  const { totals } = summary;
  const showDonations = summary.donations.enabled || totals.donationsCents !== 0;
  const { collectionRate, status, tiers, methods, methodTotalCents } = ticketBreakdown(summary, collected, donations);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="font-serif text-lg text-ink">Ticket payments</h3>
        <Link data-export-ignore data-print-hide href={`/dashboard/events/${eventId}/tickets`} className="text-sm text-wine-500 hover:text-wine-600">Open Tickets →</Link>
      </div>
      <div className="mt-4 grid sm:grid-cols-2 gap-4">
        <div className="card p-6">
          <p className="text-sm text-ink-faint">Payment summary</p>
          <dl className="mt-3 space-y-1.5 text-sm">
            <Row label="Expected" value={formatCurrency(totals.expectedCents)} tone={OWED} />
            <Row label="Collected" value={formatCurrency(totals.collectedCents)} tone={PAID} />
            <Row label="Outstanding" value={formatCurrency(totals.outstandingCents)} />
            {totals.creditCents > 0 && <Row label="Credits" value={formatCurrency(totals.creditCents)} />}
            {showDonations && <Row label={summary.donations.label} value={formatCurrency(totals.donationsCents)} tone={PAID} />}
            <Row label="Collection rate" value={collectionRate === null ? "—" : `${collectionRate}%`} />
          </dl>
          {totals.declinedExcluded > 0 && (
            <p className="mt-3 text-xs text-ink-faint">Expected excludes {formatNumber(totals.declinedExcluded)} declined.</p>
          )}
        </div>

        <div className="card p-6">
          <p className="text-sm text-ink-faint">Payment status</p>
          <dl className="mt-3 space-y-1.5 text-sm">
            <Row label="Paid in full" value={formatNumber(status.paidInFull)} />
            <Row label="Partly paid" value={formatNumber(status.partlyPaid)} />
            <Row label="Not paid yet" value={formatNumber(status.notPaid)} />
            <Row label="Nothing owed" value={formatNumber(status.nothingOwed)} />
          </dl>
          <p className="mt-3 text-xs text-ink-faint">People, counting each person&apos;s share of group payments.</p>
        </div>

        <div className="card p-6">
          <p className="text-sm text-ink-faint">By ticket type</p>
          {tiers.length === 0 ? (
            <p className="mt-2 text-xs text-ink-faint">No ticket types yet.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {tiers.map((r) => {
                const expected = r.expectedCents;
                const paid = r.paidCents;
                const pct = expected > 0 ? Math.min(100, (paid / expected) * 100) : 0;
                return (
                  <div key={r.name}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-ink-soft min-w-0 truncate">
                        {r.name}
                        {r.priceCents !== null && <span className="text-ink-faint"> · {formatCurrency(r.priceCents)}</span>}
                      </span>
                      <span className="text-ink-faint text-xs shrink-0">{formatNumber(r.people)} {r.people === 1 ? "person" : "people"}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs tabular-nums">
                      <span className={PAID}>{formatCurrency(paid)} paid</span>
                      <span className={OWED}>of {formatCurrency(expected)}</span>
                    </div>
                    {expected > 0 && (
                      <div className="mt-1 h-1.5 rounded-full bg-paper-soft overflow-hidden">
                        <div className="h-full bg-moss-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card p-6">
          <p className="text-sm text-ink-faint">By payment method</p>
          {methods.length === 0 ? (
            <p className="mt-2 text-xs text-ink-faint">No payments recorded yet.</p>
          ) : (
            <>
              <dl className="mt-3 space-y-1.5 text-sm">
                {methods.map((m) => (
                  <Row key={m.key} label={`${m.label} (${formatNumber(m.count)})`} value={formatCurrency(m.cents)} />
                ))}
                <div className="flex items-center justify-between border-t border-paper-line pt-1.5">
                  <dt className="text-ink-soft">Total</dt>
                  <dd className="text-ink font-medium tabular-nums">{formatCurrency(methodTotalCents)}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-ink-faint">
                Money received, net of refunds{showDonations ? `, including ${summary.donations.label.toLowerCase()}` : ""}.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-soft">{label}</dt>
      <dd className={`font-medium tabular-nums ${tone || "text-ink"}`}>{value}</dd>
    </div>
  );
}
