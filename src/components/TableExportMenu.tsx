"use client";

import { useEffect, useRef, useState } from "react";
import { exportDoc, type ExportDoc, type ExportFormat } from "@/lib/table-export";

const OPTIONS: { format: ExportFormat; label: string; hint: string }[] = [
  { format: "pdf", label: "PDF", hint: "Print, or choose “Save as PDF”" },
  { format: "png", label: "Image (PNG)", hint: "To share in a chat or post" },
  { format: "xlsx", label: "Excel (.xlsx)", hint: "Amounts as numbers you can add up" },
  { format: "csv", label: "CSV", hint: "For Google Sheets or other tools" },
];

/** Export button for a list shown in a modal (the Tickets card's "View all" lists). `doc` is built
 * from the same rows the modal displays. Same look as the Reports tab's Export menu. */
export function TableExportMenu({ doc }: { doc: ExportDoc }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  async function run(format: ExportFormat) {
    setOpen(false);
    setError(null);
    setBusy(true);
    try {
      await exportDoc(doc, format);
    } catch (err) {
      setError(err instanceof Error && err.message.includes("pop-ups") ? err.message : "We couldn't create that file. Try another format.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button" className="btn-secondary py-1.5 text-sm" onClick={() => setOpen((v) => !v)}
        disabled={busy} aria-haspopup="menu" aria-expanded={open}
      >
        {busy ? "Preparing…" : "Export"}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-2 w-64 max-w-[calc(100vw-3rem)] card overflow-hidden py-1">
          {OPTIONS.map((o) => (
            <button key={o.format} type="button" role="menuitem" onClick={() => run(o.format)}
              className="block w-full px-4 py-2.5 text-left text-sm text-ink hover:bg-paper-soft">
              {o.label}<span className="block text-xs text-ink-faint">{o.hint}</span>
            </button>
          ))}
        </div>
      )}
      {error && <p className="mt-2 max-w-xs text-right text-xs text-clay-600">{error}</p>}
    </div>
  );
}
