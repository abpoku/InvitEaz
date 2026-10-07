"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { formatCurrency, formatDateShort } from "@/lib/utils";
import { paymentMethodLabel } from "@/lib/payment-methods";
import type { TicketingSummary, DonationEntry, CollectedEntry } from "@/lib/models/ticketing";

/** Funds at a glance for the Tickets tab. Ticket figures and donations are separate buckets — a
 * donation never shows up in Collected or reduces Outstanding. */
export function TicketsSummaryCard({
  eventId, clone, summary,
}: {
  eventId: string;
  clone: string | null;
  summary: TicketingSummary;
}) {
  const { totals, donations } = summary;
  const [open, setOpen] = useState<"collected" | "outstanding" | "donations" | null>(null);
  const showDonationTile = donations.enabled || totals.donationsCents !== 0;

  const tile = "min-w-0 bg-white px-4 py-3";
  const linkTile = `${tile} text-left hover:bg-paper-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-wine-300`;
  const viewAll = <p className="mt-0.5 text-xs font-medium text-wine-500">View all →</p>;
  const value = "mt-0.5 font-serif text-xl text-ink tabular-nums";
  const caption = "text-xs text-ink-faint";

  return (
    <div className="card overflow-hidden">
      {/* 1px gaps over a line-colored background draw the dividers, whatever the column count. */}
      <div className={`grid grid-cols-2 ${showDonationTile ? "sm:grid-cols-4" : "sm:grid-cols-3"} gap-px bg-paper-line`}>
        <div className={tile}>
          <p className={caption}>Expected</p>
          <p className={`${value} text-wine-700`}>{formatCurrency(totals.expectedCents)}</p>
          <p className={caption}>{totals.declinedExcluded > 0 ? `Excludes ${totals.declinedExcluded} declined` : "From ticket types"}</p>
        </div>
        <button type="button" onClick={() => setOpen("collected")} className={linkTile}>
          <p className={caption}>Collected</p>
          <p className={`${value} text-moss-600`}>{formatCurrency(totals.collectedCents)}</p>
          <p className={caption}>Ticket payments, net of refunds</p>
          {viewAll}
        </button>
        <button type="button" onClick={() => setOpen("outstanding")} className={linkTile}>
          <p className={caption}>Outstanding</p>
          <p className={value}>{formatCurrency(totals.outstandingCents)}</p>
          <p className={caption}>{totals.creditCents > 0 ? `${formatCurrency(totals.creditCents)} in credits` : "Still owed"}</p>
          {viewAll}
        </button>
        {showDonationTile && (
          <button type="button" onClick={() => setOpen("donations")} className={linkTile}>
            <p className={caption}>{donations.label}</p>
            <p className={`${value} text-moss-600`}>{formatCurrency(totals.donationsCents)}</p>
            {viewAll}
          </button>
        )}
      </div>
      {open === "collected" && <CollectedModal eventId={eventId} clone={clone} total={totals.collectedCents} onClose={() => setOpen(null)} />}
      {open === "outstanding" && <OutstandingModal summary={summary} onClose={() => setOpen(null)} />}
      {open === "donations" && (
        <DonationsModal eventId={eventId} clone={clone} label={donations.label} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

/** Every ticket payment and refund behind Collected — its total is the card's figure exactly. */
function CollectedModal({ eventId, clone, total, onClose }: { eventId: string; clone: string | null; total: number; onClose: () => void }) {
  const [rows, setRows] = useState<CollectedEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/events/${eventId}/collected${clone ? `?clone=${encodeURIComponent(clone)}` : ""}`);
        let data: any = {};
        try { data = await res.json(); } catch {}
        if (!res.ok) return setError(data.error || "We couldn't load these.");
        setRows(data.payments || []);
      } catch {
        setError("We couldn't reach the server just now.");
      }
    })();
  }, [eventId, clone]);

  return (
    <Modal title="Collected" onClose={onClose} wide>
      {error ? (
        <p className="text-sm text-clay-600">{error}</p>
      ) : !rows ? (
        <p className="text-sm text-ink-faint">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-faint">No ticket payments recorded yet.</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-ink-soft">{rows.length} payment{rows.length === 1 ? "" : "s"}, newest first.</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-paper-line text-left text-ink-faint">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">From</th>
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
                      {r.kind === "refund" && <span className="ml-1.5 chip bg-brass-500/10 text-brass-600">Refund</span>}
                      {r.note && <span className="block text-xs text-ink-faint">{r.note}</span>}
                    </td>
                    <td className="py-2 pr-3 text-ink-soft">{paymentMethodLabel(r.method, r.methodOther)}</td>
                    <td className={`py-2 text-right tabular-nums whitespace-nowrap ${r.ticketCents < 0 ? "text-clay-600" : "text-moss-600"}`}>
                      {r.ticketCents < 0 ? "−" : ""}{formatCurrency(Math.abs(r.ticketCents))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-right text-sm font-medium text-ink">Total: {formatCurrency(total)}</p>
          <p className="mt-2 text-xs text-ink-faint">Only the ticket part of each payment is shown — anything given as a donation is listed under donations instead.</p>
        </>
      )}
    </Modal>
  );
}

/** Who still owes, and who's in credit — one line per party (a group as one household, an ungrouped
 * invitee on their own), exactly the way the card adds up Outstanding and credits. Built from the
 * summary the page already has, so no extra request. */
function OutstandingModal({ summary, onClose }: { summary: TicketingSummary; onClose: () => void }) {
  const groupIds = new Set(summary.groups.map((g) => g.groupId));
  const parties = [
    ...summary.groups.map((g) => ({
      id: g.groupId, name: g.name, sub: `Group · ${g.memberCount} member${g.memberCount === 1 ? "" : "s"}`,
      owed: g.owedCents, paid: g.paidCents, balance: g.balanceCents,
    })),
    ...summary.invitees
      .filter((i) => !i.groupId || !groupIds.has(i.groupId))
      .map((i) => ({ id: i.inviteeId, name: i.name, sub: i.tier || "No ticket type", owed: i.owedCents, paid: i.paidCents, balance: i.balanceCents })),
  ];
  const due = parties.filter((p) => p.balance > 0).sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
  const credit = parties.filter((p) => p.balance < 0).sort((a, b) => a.balance - b.balance || a.name.localeCompare(b.name));
  const sum = (list: typeof parties) => list.reduce((s, p) => s + Math.abs(p.balance), 0);

  const table = (list: typeof parties, kind: "due" | "credit") => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="border-b border-paper-line text-left text-ink-faint">
            <th className="py-2 pr-3 font-medium">Name</th>
            <th className="py-2 pr-3 text-right font-medium">Owed</th>
            <th className="py-2 pr-3 text-right font-medium">Paid</th>
            <th className="py-2 text-right font-medium">{kind === "due" ? "Balance" : "Credit"}</th>
          </tr>
        </thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.id} className="border-b border-paper-line last:border-0 align-top">
              <td className="py-2 pr-3 text-ink">
                {p.name}
                <span className="block text-xs text-ink-faint">{p.sub}</span>
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-wine-700">{formatCurrency(p.owed)}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-moss-600">{formatCurrency(p.paid)}</td>
              <td className="py-2 text-right tabular-nums font-medium text-ink">{formatCurrency(Math.abs(p.balance))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <Modal title="Outstanding" onClose={onClose} wide>
      {due.length === 0 ? (
        <p className="text-sm text-ink-soft">Nobody owes anything right now — everyone is paid up.</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-ink-soft">{due.length} still owe{due.length === 1 ? "s" : ""}, largest balance first. A group is listed once, as a household.</p>
          {table(due, "due")}
          <p className="mt-3 text-right text-sm font-medium text-ink">Total outstanding: {formatCurrency(sum(due))}</p>
        </>
      )}
      {credit.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-sm font-medium text-ink">In credit <span className="font-normal text-ink-faint">— paid more than they owe</span></p>
          {table(credit, "credit")}
          <p className="mt-3 text-right text-sm font-medium text-ink">Total credits: {formatCurrency(sum(credit))}</p>
        </div>
      )}
      <p className="mt-4 text-xs text-ink-faint">To record a payment or refund, use the ⋮ menu on that row in the table, or Receive payment.</p>
    </Modal>
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
