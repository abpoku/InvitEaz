"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Redo2, Shapes, Type, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { FIXTURE_SHAPES, LINE_SHAPES, LINE_TOOLS, SHAPE_TOOLS, STRUCTURE_TOOLS } from "@/lib/seating";
import { Fixture } from "./FloorPlan";

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Owner/admin floor-plan toolbar: undo/redo, the structure tools, Text, and a Shapes dropdown
 * (shapes, lines and arrows). Picking a tool turns on drawing until Esc/Done (Text: one box). */
export function DrawToolbar({ drawTool, onTool, canUndo, canRedo, onUndo, onRedo, busy }: {
  drawTool: string | null;
  onTool: (tool: string | null) => void;
  canUndo: boolean; canRedo: boolean; busy: boolean;
  onUndo: () => void; onRedo: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const mod = isMac() ? "⌘" : "Ctrl+";
  const btn = (on: boolean) => cn("inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs",
    on ? "border-wine-500 bg-wine-50 text-wine-700 font-medium" : "border-paper-line text-ink-soft hover:bg-paper-soft");
  const pick = (t: string) => onTool(drawTool === t ? null : t);
  const shapeTool = drawTool && ([...SHAPE_TOOLS, ...LINE_TOOLS] as string[]).includes(drawTool) ? drawTool : null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap text-sm" role="toolbar" aria-label="Draw structures">
      <button className="btn-ghost h-7 w-7 p-0" onClick={onUndo} disabled={!canUndo || busy} aria-label="Undo" title={`Undo (${mod}Z)`}><Undo2 className="h-4 w-4" aria-hidden="true" /></button>
      <button className="btn-ghost h-7 w-7 p-0" onClick={onRedo} disabled={!canRedo || busy} aria-label="Redo" title={`Redo (${isMac() ? "⇧⌘Z" : "Ctrl+Y"})`}><Redo2 className="h-4 w-4" aria-hidden="true" /></button>
      <span className="mx-1 h-5 w-px bg-paper-line" aria-hidden="true" />
      <span className="text-ink-faint mr-1">Draw</span>
      {STRUCTURE_TOOLS.map((t) => (
        <button key={t} aria-pressed={drawTool === t} onClick={() => pick(t)} className={btn(drawTool === t)}>{FIXTURE_SHAPES[t].label}</button>
      ))}
      <button aria-pressed={drawTool === "text"} onClick={() => pick("text")} className={btn(drawTool === "text")}><Type className="h-3.5 w-3.5" aria-hidden="true" />Text</button>
      <div ref={ref} className="relative">
        <button aria-haspopup="menu" aria-expanded={open} aria-pressed={!!shapeTool} aria-label={shapeTool ? `Shapes: ${FIXTURE_SHAPES[shapeTool].label}` : "Shapes"} onClick={() => setOpen((v) => !v)} className={btn(!!shapeTool)}>
          <Shapes className="h-3.5 w-3.5" aria-hidden="true" />{shapeTool ? FIXTURE_SHAPES[shapeTool].label : "Shapes"}<ChevronDown className="h-3 w-3" aria-hidden="true" />
        </button>
        {open && (
          <div role="menu" aria-label="Shapes" className="absolute left-0 z-40 mt-2 w-64 card p-2">
            {[{ title: "Shapes", tools: SHAPE_TOOLS }, { title: "Lines & arrows", tools: LINE_TOOLS }].map((sec) => (
              <div key={sec.title} className="mb-1 last:mb-0">
                <p className="px-1 pb-1 text-[11px] uppercase tracking-wide text-ink-faint">{sec.title}</p>
                <div className="grid grid-cols-4 gap-1">
                  {sec.tools.map((t) => {
                    const line = LINE_SHAPES.has(t);
                    return (
                      <button key={t} role="menuitem" title={FIXTURE_SHAPES[t].label} aria-label={FIXTURE_SHAPES[t].label}
                        onClick={() => { setOpen(false); onTool(t); }}
                        className={cn("flex flex-col items-center gap-1 rounded p-1.5 hover:bg-paper-soft", drawTool === t && "bg-wine-50")}>
                        <span className="relative block" style={{ width: 34, height: line ? 12 : 24, marginTop: line ? 6 : 0, marginBottom: line ? 6 : 0 }}>
                          <Fixture item={{ shape: t, label: FIXTURE_SHAPES[t].label, width: 34, height: line ? 12 : 24, rotation: 0, color: null }} selected={false} />
                        </span>
                        <span className="text-[10px] leading-tight text-ink-soft text-center">{FIXTURE_SHAPES[t].label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {drawTool && <button className="text-xs text-ink-faint hover:text-ink ml-1" onClick={() => onTool(null)}>Done</button>}
    </div>
  );
}
