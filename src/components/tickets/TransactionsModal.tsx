"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/Modal";
import { SortTh, useTableSort } from "@/components/SortableHeader";
import { TableExportMenu } from "@/components/TableExportMenu";
import { cn, formatCurrency, formatDateShort } from "@/lib/utils";
import { paymentMethodLabel } from "@/lib/payment-methods";
import { sortRows, type SortValue } from "@/lib/table-sort";
import type { ExportDoc } from "@/lib/table-export";
import type { TransactionEntry } from "@/lib/models/ticketing";

type Col = "date" | "name" | "method" | "amount" | "ticket" | "donation";
const COLUMNS: Col[] = ["date", "name", "method", "amount", "ticket", "donation"];

// Date sorts by the day the money changed hands, then by when it was entered, so same-day rows keep
// their real order.
const VALUE: Record<Col, (t: TransactionEntry) => SortValue> = {
  date: (t) => `${t.paidOn || ""}|${t.recordedAt}`,
  name: (t) => t.who,
  method: (t) => paymentMethodLabel(t.method, t.methodOther),
  amount: (t) => t.amountCents,
  ticket: (t) => t.ticketCents,
  donation: (t) => t.donationCents,
};

/** Every payment and refund for the event (or the selected clone), newest first, sortable by any
 * column. Voided entries stay in the list with their amounts struck through, so the ledger shows
 * everything that was ever entered; they never count toward the Tickets card's totals. */
export function TransactionsModal({ eventId, clone, donationsLabel, context, onClose }: {
  eventId: string;
  clone: string | null;
  donationsLabel: string;
  context: string[];
  onClose: () => void;
}) {
  const [rows, setRows] = useState<TransactionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, onSort] = useTableSort("inviteaz.sort.transactions", { key: "date", dir: "desc" }, COLUMNS);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/events/${eventId}/transactions${clone ? `?clone=${encodeURIComponent(clone)}` : ""}`);
        let data: any = {};
        try { data = await res.json(); } catch {}
        if (!res.ok) return setError(data.error || "We couldn't load the transactions.");
        setRows(data.transactions || []);
      } catch {
        setError("We couldn't reach the server just now.");
      }
    })();
  }, [eventId, clone]);

  const sorted = useMemo(
    () => (rows ? sortRows(rows, VALUE[sort.key as Col] || VALUE.date, sort.dir, (t) => t.who) : []),
    [rows, sort]
  );
  const voidedCount = rows?.filter((t) => t.voided).length || 0;
  const th = "py-2 pr-3 font-medium whitespace-nowrap";
  const money = (cents: number, voided: boolean) => (
    <span className={cn("tabular-nums", voided && "line-through decoration-1 text-ink-faint")}>
      {cents === 0 ? <span className="text-ink-faint">—</span> : formatCurrency(cents)}
    </span>
  );

  const doc = (): ExportDoc => ({
    title: "All transactions", context, fileBase: `${context[0] || "event"}-transactions`,
    note: "Refunds are negative. Voided transactions are listed for the record but don't count toward any total.",
    tables: [{
      name: "Transactions",
      columns: [{ label: "Date" }, { label: "Name" }, { label: "Group/Individual" }, { label: "Payment/Refund" }, { label: "Method" },
        { label: "Status" }, { label: "Note" }, { label: "Amount", align: "right" }, { label: "Ticket", align: "right" }, { label: donationsLabel, align: "right" }],
      rows: sorted.map((t) => [
        { date: t.paidOn || "" }, t.who + (t.removed ? " (removed)" : ""), t.targetType === "group" ? "Group" : "Individual",
        t.kind === "refund" ? "Refund" : "Payment", paymentMethodLabel(t.method, t.methodOther), t.voided ? "Voided" : "", t.note || "",
        { cents: t.amountCents }, { cents: t.ticketCents }, { cents: t.donationCents },
      ]),
    }],
  });

  return (
    <Modal title="All transactions" onClose={onClose} wide>
      {error ? (
        <p className="text-sm text-clay-600">{error}</p>
      ) : !rows ? (
        <p className="text-sm text-ink-faint">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-faint">No payments recorded yet.</p>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm text-ink-soft">
              {rows.length} transaction{rows.length === 1 ? "" : "s"}
              {voidedCount > 0 && <> · {voidedCount} voided, shown crossed out</>}
            </p>
            <TableExportMenu doc={doc()} />
          </div>
          <div className="relative overflow-x-auto">
            {/* Phones fold Date and Method into a line under the name, so the amounts fit without sideways scrolling. */}
            <table className="w-full sm:min-w-[600px] text-sm">
              <thead>
                <tr className="border-b border-paper-line text-left text-ink-faint">
                  <SortTh label="Date" column="date" sort={sort} onSort={onSort} firstDir="desc" className={cn(th, "hidden sm:table-cell")} />
                  <SortTh label="Name" column="name" sort={sort} onSort={onSort} className={th} />
                  <SortTh label="Method" column="method" sort={sort} onSort={onSort} className={cn(th, "hidden sm:table-cell")} />
                  <SortTh label="Amount" column="amount" sort={sort} onSort={onSort} firstDir="desc" className={cn(th, "text-right")} />
                  <SortTh label="Ticket" column="ticket" sort={sort} onSort={onSort} firstDir="desc" className={cn(th, "text-right")} />
                  <SortTh label={donationsLabel} column="donation" sort={sort} onSort={onSort} firstDir="desc" className={cn(th, "text-right pr-0")} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((t) => (
                  <tr key={t.paymentId} className={cn("border-b border-paper-line last:border-0 align-top", t.voided && "text-ink-faint")}>
                    <td className="hidden sm:table-cell py-2 pr-3 whitespace-nowrap text-ink-soft">{t.paidOn ? formatDateShort(t.paidOn) : "—"}</td>
                    <td className="py-2 pr-3">
                      <span className={t.voided ? "text-ink-soft" : "text-ink"}>{t.who}</span>
                      <span className="text-ink-faint"> · {t.targetType === "group" ? "Group" : "Individual"}</span>
                      {t.removed && <span className="text-ink-faint"> (removed)</span>}
                      {t.kind === "refund" && <span className="ml-1.5 chip bg-brass-500/10 text-brass-600">Refund</span>}
                      {t.voided && <span className="ml-1.5 chip bg-ink/5 text-ink-soft">Voided</span>}
                      <span className="block text-xs text-ink-faint sm:hidden">
                        {[t.paidOn ? formatDateShort(t.paidOn) : null, paymentMethodLabel(t.method, t.methodOther)].filter((x) => x && x !== "—").join(" · ")}
                      </span>
                      {t.note && <span className="block text-xs text-ink-faint">{t.note}</span>}
                    </td>
                    <td className="hidden sm:table-cell py-2 pr-3 whitespace-nowrap text-ink-soft">{paymentMethodLabel(t.method, t.methodOther)}</td>
                    <td className="py-2 pr-3 text-right font-medium">{money(t.amountCents, t.voided)}</td>
                    <td className="py-2 pr-3 text-right">{money(t.ticketCents, t.voided)}</td>
                    <td className="py-2 text-right">{money(t.donationCents, t.voided)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}
