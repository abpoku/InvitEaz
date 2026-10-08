"use client";

import { useEffect, useRef, useState } from "react";
import { localToday } from "@/lib/payment-methods";
import { slugify } from "@/lib/utils";

/** Export for the Reports tab. PDF goes through the browser's own print dialog ("Save as PDF") using
 * the print rules in globals.css, so text stays selectable and cards never split across pages. The
 * image is a PNG of #report-content. Excel/CSV come from GET .../export/report, built from the same
 * data as the page (getReportData). */
export function ReportExportMenu({ eventId, fileBase }: { eventId: string; fileBase: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const fileName = (ext: string) => `${slugify(fileBase) || "event"}-report-${localToday()}.${ext}`;

  function printPdf() {
    setOpen(false);
    // Browsers use the page title as the suggested PDF file name.
    const title = document.title;
    document.title = fileName("pdf").replace(/\.pdf$/, "");
    window.print();
    document.title = title;
  }

  async function downloadImage() {
    setOpen(false);
    setError(null);
    const el = document.getElementById("report-content");
    if (!el) return;
    setBusy(true);
    el.classList.add("report-exporting");
    try {
      const { toPng } = await import("html-to-image");
      const url = await toPng(el, {
        pixelRatio: 2,
        backgroundColor: "#FAF7F0",
        filter: (node) => !(node instanceof HTMLElement && node.dataset.exportIgnore !== undefined),
      });
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName("png");
      a.click();
    } catch {
      setError("We couldn't create the image. Try PDF instead.");
    } finally {
      el.classList.remove("report-exporting");
      setBusy(false);
    }
  }

  const sheetHref = (format: "xlsx" | "csv") => `/api/events/${eventId}/export/report?format=${format}&date=${localToday()}`;
  const item = "block w-full px-4 py-2.5 text-left text-sm text-ink hover:bg-paper-soft";
  const hint = "block text-xs text-ink-faint";

  return (
    <div ref={ref} className="relative shrink-0" data-export-ignore data-print-hide>
      <button type="button" className="btn-secondary" onClick={() => setOpen((v) => !v)} disabled={busy} aria-haspopup="menu" aria-expanded={open}>
        {busy ? "Preparing image…" : "Export"}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div role="menu" className="absolute left-0 right-0 sm:left-auto z-20 mt-2 sm:w-64 card overflow-hidden py-1">
          <button type="button" role="menuitem" className={item} onClick={printPdf}>
            PDF<span className={hint}>Print, or choose “Save as PDF”</span>
          </button>
          <button type="button" role="menuitem" className={item} onClick={downloadImage}>
            Image (PNG)<span className={hint}>To share in a chat or post</span>
          </button>
          <a role="menuitem" className={item} href={sheetHref("xlsx")} download={fileName("xlsx")} onClick={() => setOpen(false)}>
            Excel (.xlsx)<span className={hint}>A sheet per section, plus every payment</span>
          </a>
          <a role="menuitem" className={item} href={sheetHref("csv")} download={fileName("csv")} onClick={() => setOpen(false)}>
            CSV<span className={hint}>For Google Sheets or other tools</span>
          </a>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-clay-600">{error}</p>}
    </div>
  );
}

/** "Generated <date>" in the planner's own timezone, shown only in exports. */
export function GeneratedStamp() {
  const [today, setToday] = useState("");
  useEffect(() => {
    setToday(new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }));
  }, []);
  return <p className="report-export-only mt-1 text-xs text-ink-faint">Generated {today}</p>;
}
