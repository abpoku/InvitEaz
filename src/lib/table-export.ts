// Browser-only: turns a list a planner is looking at into a downloadable file — CSV, Excel, a PNG, or a
// PDF via the print dialog. Used by the Tickets card's "View all" lists (Collected, Outstanding,
// Donations); the rows passed in are exactly what the modal shows, so a file always matches the screen.

import { csvEscape, formatCurrency, formatDateShort, slugify } from "@/lib/utils";
import { localToday } from "@/lib/payment-methods";

export type ExportFormat = "pdf" | "png" | "xlsx" | "csv";
/** A cell: text, a plain number, money (integer cents — a real currency number in Excel), or a
 * YYYY-MM-DD date (kept as-is in spreadsheets so it sorts; "Oct 8, 2026" on the printed page). */
export type ExportCell = string | number | null | { cents: number } | { date: string };
const isMoney = (c: ExportCell): c is { cents: number } => !!c && typeof c === "object" && "cents" in c;
const isDate = (c: ExportCell): c is { date: string } => !!c && typeof c === "object" && "date" in c;

export interface ExportTable {
  /** Section heading, and the sheet name in Excel (max 31 chars there). */
  name: string;
  columns: { label: string; align?: "right" }[];
  rows: ExportCell[][];
  total?: { label: string; cents: number };
}

export interface ExportDoc {
  title: string;       // e.g. "Collected"
  context: string[];   // e.g. ["2026 Christmas Party", "North"] — shown under the title
  fileBase: string;    // e.g. "christmas-party-collected"
  tables: ExportTable[];
  note?: string;
}

export async function exportDoc(doc: ExportDoc, format: ExportFormat): Promise<void> {
  const today = localToday();
  const fileName = `${slugify(doc.fileBase) || "export"}-${today}`;
  if (format === "csv") return download(new Blob(["﻿" + toCsv(doc, today)], { type: "text/csv;charset=utf-8" }), `${fileName}.csv`);
  if (format === "xlsx") return toXlsx(doc, today, `${fileName}.xlsx`);
  if (format === "png") return toPng(doc, `${fileName}.png`);
  return toPdf(doc, fileName);
}

// ---------- CSV / Excel ----------

function toCsv(doc: ExportDoc, today: string): string {
  const lines = [csvText(doc.title), ...doc.context.map(csvText), csvText(`Generated ${today}`), ""];
  doc.tables.forEach((t, i) => {
    if (doc.tables.length > 1) lines.push(csvText(t.name));
    lines.push(t.columns.map((c) => csvText(c.label)).join(","));
    for (const row of t.rows) lines.push(row.map(csvValue).join(","));
    if (t.total) lines.push(t.columns.map((_, ci) => (ci === 0 ? csvText(t.total!.label) : ci === t.columns.length - 1 ? (t.total!.cents / 100).toFixed(2) : "")).join(","));
    if (i < doc.tables.length - 1) lines.push("");
  });
  return lines.join("\n");
}

function csvValue(c: ExportCell): string {
  if (c === null) return "";
  if (isMoney(c)) return (c.cents / 100).toFixed(2);
  if (isDate(c)) return c.date;
  if (typeof c === "number") return String(c);
  return csvText(c);
}

/** Text that a spreadsheet would run as a formula (= + - @) is prefixed with ' so it opens as text. */
function csvText(s: string): string {
  return csvEscape(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
}

async function toXlsx(doc: ExportDoc, today: string, fileName: string): Promise<void> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const t of doc.tables) {
    const money = (cents: number) => ({ v: cents / 100, t: "n", z: '"$"#,##0.00' });
    const aoa: unknown[][] = [
      [doc.title], ...doc.context.map((c) => [c]), [`Generated ${today}`], [],
      t.columns.map((c) => c.label),
      ...t.rows.map((row) => row.map((c) => (isMoney(c) ? money(c.cents) : isDate(c) ? c.date : c ?? ""))),
    ];
    if (t.total) aoa.push(t.columns.map((_, ci) => (ci === 0 ? t.total!.label : ci === t.columns.length - 1 ? money(t.total!.cents) : "")));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = t.columns.map((c, ci) => ({
      wch: Math.min(40, Math.max(c.label.length, ...t.rows.map((r) => cellText(r[ci]).length)) + 2),
    }));
    // Sheet names: max 31 chars, no []:*?/\ characters, unique within the workbook.
    let name = t.name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Sheet";
    for (let n = 2; used.has(name); n++) name = `${t.name.slice(0, 27)} (${n})`;
    used.add(name);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  XLSX.writeFile(wb, fileName);
}

// ---------- PDF / PNG (same printable page) ----------

const COLORS = { ink: "#1F1A17", soft: "#5B534B", faint: "#8C8378", line: "#E4DCC7", paper: "#FAF7F0", refund: "#973A26" };

function cellText(c: ExportCell): string {
  if (c === null) return "";
  if (isMoney(c)) return formatCurrency(c.cents);
  if (isDate(c)) return c.date ? formatDateShort(c.date) : "—";
  return String(c);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

/** The printable page body — inline styles only, so it renders the same in a print window and in the
 * off-screen node the PNG is captured from. */
function pageHtml(doc: ExportDoc): string {
  const th = (align?: string) => `text-align:${align || "left"};padding:8px 10px 8px 0;font-weight:500;color:${COLORS.faint};border-bottom:1px solid ${COLORS.line};white-space:nowrap`;
  const td = (align?: string, color = COLORS.ink) => `text-align:${align || "left"};padding:7px 10px 7px 0;color:${color};border-bottom:1px solid ${COLORS.line};vertical-align:top;font-variant-numeric:tabular-nums`;
  const tables = doc.tables.map((t) => `
    ${doc.tables.length > 1 ? `<h2 style="font-family:Georgia,serif;font-weight:400;font-size:17px;margin:26px 0 8px;color:${COLORS.ink}">${esc(t.name)}</h2>` : ""}
    <table style="width:100%;border-collapse:collapse;font-size:12.5px">
      <thead><tr>${t.columns.map((c) => `<th style="${th(c.align)}">${esc(c.label)}</th>`).join("")}</tr></thead>
      <tbody>${t.rows.map((row) => `<tr>${row.map((c, ci) => {
        const negative = isMoney(c) && c.cents < 0;
        const nowrap = isMoney(c) || isDate(c) ? ";white-space:nowrap" : "";
        return `<td style="${td(t.columns[ci]?.align, negative ? COLORS.refund : ci === 0 ? COLORS.ink : COLORS.soft)}${nowrap}">${esc(cellText(c))}</td>`;
      }).join("")}</tr>`).join("")}</tbody>
    </table>
    ${t.total ? `<p style="text-align:right;margin:10px 0 0;font-size:13px;font-weight:600;color:${COLORS.ink}">${esc(t.total.label)}: ${esc(formatCurrency(t.total.cents))}</p>` : ""}
  `).join("");
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.ink}">
      <p style="margin:0;font-size:12px;color:${COLORS.faint}">${esc(doc.context.join(" · "))}</p>
      <h1 style="font-family:Georgia,serif;font-weight:400;font-size:24px;margin:4px 0 2px">${esc(doc.title)}</h1>
      <p style="margin:0 0 14px;font-size:11px;color:${COLORS.faint}">Generated ${esc(formatToday())}</p>
      ${tables}
      ${doc.note ? `<p style="margin-top:16px;font-size:11px;color:${COLORS.faint}">${esc(doc.note)}</p>` : ""}
    </div>`;
}

function toPdf(doc: ExportDoc, fileName: string): void {
  // A separate window holding only this list, so the print has no modal, page chrome or scroll clipping.
  // The browser suggests the window's <title> as the PDF's file name.
  const w = window.open("", "_blank");
  if (!w) throw new Error("Your browser blocked the print window. Allow pop-ups for this site and try again.");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(fileName)}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>@page{margin:14mm} body{margin:24px;background:#fff} tr{break-inside:avoid} *{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style>
    </head><body>${pageHtml(doc)}</body></html>`);
  w.document.close();
  w.focus();
  // Give the new window a moment to lay out before opening the print dialog.
  setTimeout(() => w.print(), 250);
}

async function toPng(doc: ExportDoc, fileName: string): Promise<void> {
  // Rendered off-screen at a fixed width, so the image holds the whole list (not just what fits in the
  // modal) and looks the same on a phone as on a laptop.
  const node = document.createElement("div");
  node.style.cssText = `position:fixed;left:-10000px;top:0;width:760px;padding:28px;background:${COLORS.paper}`;
  node.innerHTML = pageHtml(doc);
  document.body.appendChild(node);
  try {
    const { toPng: render } = await import("html-to-image");
    // The off-screen position is copied into the image too, which would leave it blank — reset it there.
    const url = await render(node, { pixelRatio: 2, backgroundColor: COLORS.paper, style: { position: "static", left: "0", top: "0" } });
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
  } finally {
    node.remove();
  }
}

// ---------- helpers ----------

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatToday(): string {
  return new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
