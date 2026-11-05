"use client";

import { useEffect, useRef, useState } from "react";
import { exportDoc, type ExportDoc, type ExportFormat } from "@/lib/table-export";
import { slugify } from "@/lib/utils";

type Option = { key: string; label: string; hint: string; run: () => Promise<void> };

/** Exports: the floor plan as an image, and the seating list by guest name (for escort cards) or by
 * table (for the venue), each as PDF / Excel / CSV via the shared table exporter. */
export function SeatingExportMenu({ eventName, floorRef, byName, byTable }: {
  eventName: string;
  floorRef: React.RefObject<HTMLDivElement>;
  byName: () => ExportDoc;
  byTable: () => ExportDoc;
}) {
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

  async function floorImage() {
    const el = floorRef.current;
    if (!el) throw new Error("Switch to the floor view to export the floor plan.");
    const { toPng } = await import("html-to-image");
    // Render at 100% whatever the on-screen zoom is.
    const url = await toPng(el, { pixelRatio: 2, backgroundColor: "#ffffff", style: { transform: "none" } });
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugify(eventName) || "event"}-floor-plan.png`;
    a.click();
  }

  const doc = (fn: () => ExportDoc, f: ExportFormat) => () => exportDoc(fn(), f);
  const options: Option[] = [
    { key: "floor", label: "Floor plan (PNG)", hint: "The layout as an image", run: floorImage },
    { key: "name-pdf", label: "Guests A–Z with table (PDF)", hint: "For escort cards or a welcome table", run: doc(byName, "pdf") },
    { key: "name-xlsx", label: "Guests A–Z with table (Excel)", hint: "For a place-card printer", run: doc(byName, "xlsx") },
    { key: "name-csv", label: "Guests A–Z with table (CSV)", hint: "For Google Sheets or other tools", run: doc(byName, "csv") },
    { key: "table-pdf", label: "Guests by table (PDF)", hint: "For the venue or caterer", run: doc(byTable, "pdf") },
    { key: "table-xlsx", label: "Guests by table (Excel)", hint: "One section per table", run: doc(byTable, "xlsx") },
  ];

  async function run(o: Option) {
    setOpen(false);
    setError(null);
    setBusy(true);
    try { await o.run(); }
    catch (err) { setError(err instanceof Error && err.message ? err.message : "We couldn't create that file."); }
    finally { setBusy(false); }
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" className="btn-secondary py-1.5 text-sm" onClick={() => setOpen((v) => !v)} disabled={busy} aria-haspopup="menu" aria-expanded={open}>
        {busy ? "Preparing…" : "Export"}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-72 max-w-[calc(100vw-3rem)] card overflow-hidden py-1">
          {options.map((o) => (
            <button key={o.key} type="button" role="menuitem" onClick={() => run(o)} className="block w-full px-4 py-2.5 text-left text-sm text-ink hover:bg-paper-soft">
              {o.label}<span className="block text-xs text-ink-faint">{o.hint}</span>
            </button>
          ))}
        </div>
      )}
      {error && <p className="absolute right-0 mt-2 w-64 text-right text-xs text-clay-600">{error}</p>}
    </div>
  );
}
