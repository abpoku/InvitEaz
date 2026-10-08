import * as XLSX from "xlsx";
import { requireAssemblyScope } from "@/lib/session";
import { getReportData, type ReportData } from "@/lib/report-data";
import { ticketBreakdown } from "@/lib/report-tickets";
import { paymentMethodLabel } from "@/lib/payment-methods";
import { csvEscape, slugify } from "@/lib/utils";

/** The Reports tab as a spreadsheet: `?format=xlsx` (a workbook, one sheet per section, plus every
 * payment when ticketing is on) or `?format=csv` (one Section/Item/Value table). Same data and the
 * same clone scoping as the page itself (getReportData). `?date=YYYY-MM-DD` is the planner's local
 * "today" for the file name and the Generated line — the server's own clock is UTC. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return new Response(access.message, { status: access.status });

  const url = new URL(req.url);
  const format = url.searchParams.get("format");
  if (format !== "xlsx" && format !== "csv") return new Response("Unknown format.", { status: 400 });
  const dateParam = url.searchParams.get("date") || "";
  const generated = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : new Date().toISOString().slice(0, 10);

  const data = await getReportData(params.id, access.assemblyId);
  const fileName = `${slugify(data.event.name) || "event"}-report-${generated}.${format}`;
  const disposition = `attachment; filename="${fileName}"`;

  if (format === "csv") {
    const rows = sectionRows(data, generated);
    for (const { question, rows: answers } of data.questionReports) {
      for (const a of answers) rows.push([`Question: ${question.label}`, a.value, a.count]);
    }
    for (const c of data.clones) {
      rows.push(
        [`Clone: ${c.clone.name}`, "Invited", c.stats.invited],
        [`Clone: ${c.clone.name}`, "Attending", c.stats.attending],
        [`Clone: ${c.clone.name}`, "Response rate", pct(c.stats.responseRate)],
        ...(c.tickets ? [
          [`Clone: ${c.clone.name}`, "Collected", money(c.tickets.collectedCents)],
          [`Clone: ${c.clone.name}`, "Outstanding", money(c.tickets.outstandingCents)],
        ] as Cell[][] : []),
      );
    }
    const lines = ["Section,Item,Value", ...rows.map((r) => r.map(csvCell).join(","))];
    // BOM so Excel opens accented names and "—" correctly.
    return new Response("﻿" + lines.join("\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": disposition } });
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet([["Section", "Item", "Value"], ...sectionRows(data, generated)], [22, 34, 16]), "Summary");

  if (data.questionReports.length > 0) {
    const rows: Cell[][] = [["Question", "Answer", "Count"]];
    for (const { question, rows: answers } of data.questionReports) {
      if (answers.length === 0) rows.push([question.label, "No answers yet", ""]);
      for (const a of answers) rows.push([question.label, a.value, a.count]);
    }
    XLSX.utils.book_append_sheet(wb, sheet(rows, [40, 30, 10]), "Questions");
  }

  if (data.clones.length > 0) {
    const ticketCols = data.tickets ? ["Collected", "Outstanding"] : [];
    const rows: Cell[][] = [["Clone", "Invited", "Attending", "Maybe", "Declined", "No response", "Response rate", ...ticketCols]];
    for (const c of data.clones) {
      rows.push([
        c.clone.name, c.stats.invited, c.stats.attending, c.stats.maybe, c.stats.declined, c.stats.noResponse, pct(c.stats.responseRate),
        ...(c.tickets ? [money(c.tickets.collectedCents), money(c.tickets.outstandingCents)] : []),
      ]);
    }
    XLSX.utils.book_append_sheet(wb, sheet(rows, [24, 10, 10, 10, 10, 12, 14, 14, 14]), "Clones");
  }

  if (data.tickets) {
    // One row per transaction. A payment split between tickets and donations appears in both of the
    // source lists, so the two are merged by payment id.
    const { collected, donations } = data.tickets;
    const byId = new Map<string, { paidOn: string | null; who: string; kind: string; ticket: number; donation: number; method: string; note: string }>();
    const entry = (e: { paymentId: string; paidOn: string | null; who: string; kind: string; method: string | null; methodOther: string | null; note: string | null }) =>
      byId.get(e.paymentId) || { paidOn: e.paidOn, who: e.who, kind: e.kind === "refund" ? "Refund" : "Payment", ticket: 0, donation: 0, method: paymentMethodLabel(e.method, e.methodOther), note: e.note || "" };
    for (const c of collected) { const r = entry(c); r.ticket += c.ticketCents; byId.set(c.paymentId, r); }
    for (const d of donations) { const r = entry(d); r.donation += d.kind === "refund" ? -d.donationCents : d.donationCents; byId.set(d.paymentId, r); }
    const label = data.tickets.summary.donations.label;
    const rows: Cell[][] = [["Date", "From", "Type", "Tickets", label, "Total", "Method", "Note"]];
    for (const r of byId.values()) rows.push([r.paidOn || "", r.who, r.kind, money(r.ticket), money(r.donation), money(r.ticket + r.donation), r.method, r.note]);
    XLSX.utils.book_append_sheet(wb, sheet(rows, [12, 26, 10, 12, 14, 12, 20, 30]), "Payments");
  }

  const body = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(body), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": disposition },
  });
}

/** A spreadsheet cell: text, a whole number, or a formatted number (money or a percentage) that
 * stays a real number in Excel, so planners can sum and chart it. */
type Cell = string | number | { v: number; t: "n"; z: string };
const money = (cents: number): Cell => ({ v: cents / 100, t: "n", z: '"$"#,##0.00' });
const pct = (whole: number): Cell => ({ v: whole / 100, t: "n", z: "0%" });

/** Every on-screen card as Section/Item/Value rows — the CSV and the workbook's Summary sheet. */
function sectionRows(data: ReportData, generated: string): Cell[][] {
  const { event, cloneName, stats, tickets } = data;
  const rows: Cell[][] = [
    ["Report", "Event", event.name],
    ...(cloneName ? [["Report", "Clone", cloneName] as Cell[]] : []),
    ["Report", "Event date", event.event_date],
    ["Report", "Generated", generated],
    ["Invitation summary", "Invited", stats.invited],
    ["Invitation summary", "Responded", stats.responded],
    ["Invitation summary", "No response", stats.noResponse],
    ["Invitation summary", "Response rate", pct(stats.responseRate)],
    ["RSVP summary", "Attending", stats.attending],
    ["RSVP summary", "Maybe", stats.maybe],
    ["RSVP summary", "Declined", stats.declined],
    ["RSVP summary", "Pending", stats.noResponse],
    ["Attendance", "Total attendees", stats.totalAttendees],
    ["Attendance", "Adults", data.adults],
    ["Attendance", "Children", data.children],
  ];
  if (!tickets) return rows;

  const { totals, donations } = tickets.summary;
  const b = ticketBreakdown(tickets.summary, tickets.collected, tickets.donations);
  rows.push(
    ["Payment summary", "Expected", money(totals.expectedCents)],
    ["Payment summary", "Collected", money(totals.collectedCents)],
    ["Payment summary", "Outstanding", money(totals.outstandingCents)],
    ["Payment summary", "Credits", money(totals.creditCents)],
  );
  if (donations.enabled || totals.donationsCents !== 0) rows.push(["Payment summary", donations.label, money(totals.donationsCents)]);
  rows.push(
    ["Payment summary", "Collection rate", b.collectionRate === null ? "—" : pct(b.collectionRate)],
    ["Payment status", "Paid in full", b.status.paidInFull],
    ["Payment status", "Partly paid", b.status.partlyPaid],
    ["Payment status", "Not paid yet", b.status.notPaid],
    ["Payment status", "Nothing owed", b.status.nothingOwed],
  );
  for (const t of b.tiers) {
    const name = t.priceCents === null ? t.name : `${t.name} (${dollars(t.priceCents)})`;
    rows.push(
      ["By ticket type", `${name} — people`, t.people],
      ["By ticket type", `${name} — paid`, money(t.paidCents)],
      ["By ticket type", `${name} — expected`, money(t.expectedCents)],
    );
  }
  for (const m of b.methods) rows.push(["By payment method", `${m.label} (${m.count})`, money(m.cents)]);
  if (b.methods.length > 0) rows.push(["By payment method", "Total", money(b.methodTotalCents)]);
  return rows;
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function sheet(rows: Cell[][], widths: number[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = widths.map((wch) => ({ wch }));
  return ws;
}

/** CSV value. Money/percentages are written as plain numbers; text that a spreadsheet would run as a
 * formula (guest-typed answers can start with = + - @) is prefixed with ' so it opens as text. */
function csvCell(c: Cell): string {
  if (typeof c === "object") return String(c.z.includes("%") ? `${Math.round(c.v * 100)}%` : c.v.toFixed(2));
  if (typeof c === "number") return String(c);
  return csvEscape(/^[=+\-@\t\r]/.test(c) ? `'${c}` : c);
}
