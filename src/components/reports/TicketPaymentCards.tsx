import Link from "next/link";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { PAYMENT_METHODS, paymentMethodLabel } from "@/lib/payment-methods";
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
  const collectionRate = totals.expectedCents > 0 ? Math.round((totals.collectedCents / totals.expectedCents) * 100) : null;

  // People by payment status — per person, with each group payment already shared out to the members
  // who owe something (getTicketingSummary), the same Paid figure the Tickets tab shows per row.
  const people = summary.invitees;
  const owing = people.filter((p) => p.owedCents > 0);
  const paidInFull = owing.filter((p) => p.balanceCents <= 0).length;
  const partlyPaid = owing.filter((p) => p.balanceCents > 0 && p.paidCents > 0).length;
  const notPaid = owing.filter((p) => p.paidCents <= 0).length;
  const nothingOwed = people.length - owing.length;

  // By ticket type, in the order the tiers are configured; anyone without one (or with a value that
  // matches no configured tier) is grouped under "No ticket type".
  const tierNames = new Set(summary.tiers.map((t) => t.name));
  const tierRows = [
    ...summary.tiers.map((t) => ({ name: t.name, priceCents: t.priceCents as number | null, members: people.filter((p) => p.tier === t.name) })),
    { name: "No ticket type", priceCents: null, members: people.filter((p) => !tierNames.has(p.tier)) },
  ].filter((r) => r.priceCents !== null || r.members.length > 0);

  // By payment method: ticket money plus donations, net of refunds. Adds up to Collected + Donations.
  // A payment split between tickets and donations is in both lists — count it once.
  const byMethod = new Map<string, { label: string; cents: number; ids: Set<string> }>();
  const add = (paymentId: string, method: string | null, other: string | null, cents: number) => {
    const key = method === "other" ? `other:${(other || "").trim().toLowerCase()}` : method || "none";
    const label = method ? paymentMethodLabel(method, other) : "Not recorded";
    const entry = byMethod.get(key) || { label, cents: 0, ids: new Set<string>() };
    entry.cents += cents;
    entry.ids.add(paymentId);
    byMethod.set(key, entry);
  };
  for (const c of collected) add(c.paymentId, c.method, c.methodOther, c.ticketCents);
  for (const d of donations) add(d.paymentId, d.method, d.methodOther, d.kind === "refund" ? -d.donationCents : d.donationCents);
  const methodOrder = (key: string) => {
    const i = PAYMENT_METHODS.findIndex((m) => key === m.value || key.startsWith(`${m.value}:`));
    return i === -1 ? PAYMENT_METHODS.length : i;
  };
  const methodRows = [...byMethod.entries()].sort(([a], [b]) => methodOrder(a) - methodOrder(b) || a.localeCompare(b));
  const methodTotal = methodRows.reduce((sum, [, m]) => sum + m.cents, 0);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="font-serif text-lg text-ink">Ticket payments</h3>
        <Link href={`/dashboard/events/${eventId}/tickets`} className="text-sm text-wine-500 hover:text-wine-600">Open Tickets →</Link>
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
            <Row label="Paid in full" value={formatNumber(paidInFull)} />
            <Row label="Partly paid" value={formatNumber(partlyPaid)} />
            <Row label="Not paid yet" value={formatNumber(notPaid)} />
            <Row label="Nothing owed" value={formatNumber(nothingOwed)} />
          </dl>
          <p className="mt-3 text-xs text-ink-faint">People, counting each person&apos;s share of group payments.</p>
        </div>

        <div className="card p-6">
          <p className="text-sm text-ink-faint">By ticket type</p>
          {tierRows.length === 0 ? (
            <p className="mt-2 text-xs text-ink-faint">No ticket types yet.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {tierRows.map((r) => {
                const expected = r.members.reduce((sum, p) => sum + p.owedCents, 0);
                const paid = r.members.reduce((sum, p) => sum + p.paidCents, 0);
                const pct = expected > 0 ? Math.min(100, (paid / expected) * 100) : 0;
                return (
                  <div key={r.name}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-ink-soft min-w-0 truncate">
                        {r.name}
                        {r.priceCents !== null && <span className="text-ink-faint"> · {formatCurrency(r.priceCents)}</span>}
                      </span>
                      <span className="text-ink-faint text-xs shrink-0">{formatNumber(r.members.length)} {r.members.length === 1 ? "person" : "people"}</span>
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
          {methodRows.length === 0 ? (
            <p className="mt-2 text-xs text-ink-faint">No payments recorded yet.</p>
          ) : (
            <>
              <dl className="mt-3 space-y-1.5 text-sm">
                {methodRows.map(([key, m]) => (
                  <Row key={key} label={`${m.label} (${formatNumber(m.ids.size)})`} value={formatCurrency(m.cents)} />
                ))}
                <div className="flex items-center justify-between border-t border-paper-line pt-1.5">
                  <dt className="text-ink-soft">Total</dt>
                  <dd className="text-ink font-medium tabular-nums">{formatCurrency(methodTotal)}</dd>
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
