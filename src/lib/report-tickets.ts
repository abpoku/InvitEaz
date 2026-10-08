// Pure, client-safe: the Reports tab's ticket breakdowns, shared by the on-screen cards
// (TicketPaymentCards) and the Excel/CSV export (export/report route), so they can't disagree.

import { PAYMENT_METHODS, paymentMethodLabel } from "@/lib/payment-methods";
import type { TicketingSummary, CollectedEntry, DonationEntry } from "@/lib/models/ticketing";

export interface TicketBreakdown {
  collectionRate: number | null; // % of Expected collected; null when nothing is expected
  status: { paidInFull: number; partlyPaid: number; notPaid: number; nothingOwed: number };
  tiers: { name: string; priceCents: number | null; people: number; expectedCents: number; paidCents: number }[];
  methods: { key: string; label: string; cents: number; count: number }[];
  methodTotalCents: number; // = Collected + Donations
}

export function ticketBreakdown(summary: TicketingSummary, collected: CollectedEntry[], donations: DonationEntry[]): TicketBreakdown {
  const { totals } = summary;
  const collectionRate = totals.expectedCents > 0 ? Math.round((totals.collectedCents / totals.expectedCents) * 100) : null;

  // People by payment status — per person, with each group payment already shared out to the members
  // who owe something (getTicketingSummary), the same Paid figure the Tickets tab shows per row.
  const people = summary.invitees;
  const owing = people.filter((p) => p.owedCents > 0);
  const status = {
    paidInFull: owing.filter((p) => p.balanceCents <= 0).length,
    partlyPaid: owing.filter((p) => p.balanceCents > 0 && p.paidCents > 0).length,
    notPaid: owing.filter((p) => p.paidCents <= 0).length,
    nothingOwed: people.length - owing.length,
  };

  // By ticket type, in the order the tiers are configured; anyone without one (or with a value that
  // matches no configured tier) is grouped under "No ticket type".
  const tierNames = new Set(summary.tiers.map((t) => t.name));
  const tiers = [
    ...summary.tiers.map((t) => ({ name: t.name, priceCents: t.priceCents as number | null, members: people.filter((p) => p.tier === t.name) })),
    { name: "No ticket type", priceCents: null, members: people.filter((p) => !tierNames.has(p.tier)) },
  ]
    .filter((r) => r.priceCents !== null || r.members.length > 0)
    .map((r) => ({
      name: r.name,
      priceCents: r.priceCents,
      people: r.members.length,
      expectedCents: r.members.reduce((sum, p) => sum + p.owedCents, 0),
      paidCents: r.members.reduce((sum, p) => sum + p.paidCents, 0),
    }));

  // By payment method: ticket money plus donations, net of refunds — adds up to Collected + Donations.
  // A payment split between tickets and donations is in both lists, so it's counted once.
  const byMethod = new Map<string, { label: string; cents: number; ids: Set<string> }>();
  const add = (paymentId: string, method: string | null, other: string | null, cents: number) => {
    const key = method === "other" ? `other:${(other || "").trim().toLowerCase()}` : method || "none";
    const entry = byMethod.get(key) || { label: method ? paymentMethodLabel(method, other) : "Not recorded", cents: 0, ids: new Set<string>() };
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
  const methods = [...byMethod.entries()]
    .sort(([a], [b]) => methodOrder(a) - methodOrder(b) || a.localeCompare(b))
    .map(([key, m]) => ({ key, label: m.label, cents: m.cents, count: m.ids.size }));

  return { collectionRate, status, tiers, methods, methodTotalCents: methods.reduce((sum, m) => sum + m.cents, 0) };
}
