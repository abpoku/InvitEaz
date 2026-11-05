"use client";

import { forwardRef, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { floorSize, snap, GRID, type SeatingItem } from "@/lib/seating";
import { GUEST_DRAG } from "./types";

export interface TableLook {
  used: number;
  pending: number;
  color: string | null;   // clone color when set aside for a clone
  enabled: boolean;       // can the viewer seat guests here
  warnings: number;
}

interface Props {
  items: SeatingItem[];
  zoom: number;
  selectedId: string | null;
  canEditLayout: boolean;
  seatMode: boolean; // guests are selected: clicking a table seats them
  look: (table: SeatingItem) => TableLook;
  onSelect: (id: string | null) => void;
  onSeatSelected: (tableId: string) => void;
  onDropGuests: (ids: string[], tableId: string) => void;
  onMove: (id: string, x: number, y: number) => void;
}

/** The floor: tables and fixtures at their saved positions, scaled by `zoom`. Owner/admin drag items
 * to move them (pointer events, snapped to the grid; arrow keys nudge the selected one). Guests are
 * dropped onto tables with native drag-and-drop from the guest panel, or seated by selecting them
 * and clicking a table — the tap path phones and keyboards use. */
export const FloorPlan = forwardRef<HTMLDivElement, Props>(function FloorPlan(
  { items, zoom, selectedId, canEditLayout, seatMode, look, onSelect, onSeatSelected, onDropGuests, onMove }, exportRef
) {
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const start = useRef<{ id: string; px: number; py: number; ox: number; oy: number; moved: boolean } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const size = floorSize(items);

  function activate(item: SeatingItem) {
    if (seatMode && item.kind === "table") onSeatSelected(item.id);
    else onSelect(item.id);
  }

  function pointerDown(e: React.PointerEvent, item: SeatingItem) {
    e.stopPropagation();
    if (!canEditLayout || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { id: item.id, px: e.clientX, py: e.clientY, ox: item.x, oy: item.y, moved: false };
  }
  function pointerMove(e: React.PointerEvent) {
    const s = start.current;
    if (!s) return;
    const dx = (e.clientX - s.px) / zoom, dy = (e.clientY - s.py) / zoom;
    if (!s.moved && Math.hypot(dx, dy) < 4) return;
    s.moved = true;
    setDrag({ id: s.id, x: Math.max(0, snap(s.ox + dx)), y: Math.max(0, snap(s.oy + dy)) });
  }
  function pointerUp(item: SeatingItem) {
    const s = start.current;
    start.current = null;
    if (s?.moved && drag) {
      if (drag.x !== item.x || drag.y !== item.y) onMove(item.id, drag.x, drag.y);
      setDrag(null);
    } else if (!canEditLayout || s) {
      activate(item);
    }
  }
  function keyDown(e: React.KeyboardEvent, item: SeatingItem) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(item); return; }
    if (!canEditLayout || selectedId !== item.id) return;
    const step = e.shiftKey ? GRID * 5 : GRID;
    const d = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, number[]>)[e.key];
    if (!d) return;
    e.preventDefault();
    onMove(item.id, Math.max(0, item.x + d[0]), Math.max(0, item.y + d[1]));
  }

  return (
    <div style={{ width: size.width * zoom, height: size.height * zoom }} className="relative">
      <div
        ref={exportRef}
        onClick={() => onSelect(null)}
        className="absolute left-0 top-0 origin-top-left bg-white"
        style={{
          width: size.width, height: size.height, transform: `scale(${zoom})`,
          backgroundImage: "linear-gradient(#EFE9DB 1px, transparent 1px), linear-gradient(90deg, #EFE9DB 1px, transparent 1px)",
          backgroundSize: `${GRID * 4}px ${GRID * 4}px`,
        }}
      >
        {items.map((item) => {
          const pos = drag?.id === item.id ? drag : item;
          const isTable = item.kind === "table";
          const l = isTable ? look(item) : null;
          const over = !!l && item.capacity !== null && l.used > item.capacity;
          const full = !!l && item.capacity !== null && !over && l.used >= item.capacity && item.capacity > 0;
          return (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              aria-label={isTable ? `${item.label}, ${l!.used} of ${item.capacity ?? "unlimited"} seats taken` : item.label}
              aria-pressed={selectedId === item.id}
              onPointerDown={(e) => pointerDown(e, item)}
              onPointerMove={pointerMove}
              onPointerUp={() => pointerUp(item)}
              onPointerCancel={() => { start.current = null; setDrag(null); }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => keyDown(e, item)}
              onDragOver={(e) => {
                if (!isTable || !l!.enabled || !e.dataTransfer.types.includes(GUEST_DRAG)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (hover !== item.id) setHover(item.id);
              }}
              onDragLeave={() => setHover((h) => (h === item.id ? null : h))}
              onDrop={(e) => {
                setHover(null);
                const raw = e.dataTransfer.getData(GUEST_DRAG);
                if (!raw) return;
                e.preventDefault();
                onDropGuests(JSON.parse(raw), item.id);
              }}
              className={cn(
                "absolute select-none touch-none outline-none",
                canEditLayout ? (drag?.id === item.id ? "cursor-grabbing z-20" : "cursor-grab") : "cursor-pointer",
                isTable && !l!.enabled && "opacity-45",
              )}
              style={{ left: pos.x, top: pos.y, width: item.width, height: item.height, transform: `rotate(${item.rotation}deg)` }}
            >
              {isTable && <Chairs item={item} used={l!.used} over={over} />}
              <div
                className={cn(
                  "absolute inset-0 flex items-center justify-center text-center border-2 transition-shadow",
                  isTable ? (item.shape === "round" ? "rounded-full" : "rounded-md") : "rounded-sm border-dashed",
                  isTable
                    ? over ? "bg-[#F6E3DE] border-clay-500" : full ? "bg-brass-50" : "bg-white"
                    : item.shape === "stage" ? "bg-ink/10 border-ink/30" : item.shape === "dance_floor" ? "bg-wine-50 border-wine-200" : "bg-paper-soft border-ink/25",
                  selectedId === item.id && "ring-2 ring-wine-500 ring-offset-2",
                  hover === item.id && "ring-2 ring-moss-400 ring-offset-2",
                  seatMode && isTable && l!.enabled && "hover:ring-2 hover:ring-moss-400",
                )}
                style={isTable && !over ? { borderColor: l!.color || "rgba(30,34,51,0.25)" } : undefined}
              >
                {/* Text stays upright however the item is rotated. */}
                <div style={{ transform: `rotate(${-item.rotation}deg)` }} className="px-1 leading-tight pointer-events-none">
                  <p className={cn("font-medium text-ink", isTable ? "text-xs" : "text-[11px] italic text-ink-soft")}>{item.label}</p>
                  {isTable && (
                    <p className={cn("text-[11px] tabular-nums", over ? "text-clay-600 font-semibold" : "text-ink-faint")}>
                      {l!.used}/{item.capacity ?? "∞"}
                    </p>
                  )}
                </div>
              </div>
              {isTable && (l!.pending > 0 || l!.warnings > 0) && (
                <div className="absolute -top-2 -right-2 flex gap-0.5 pointer-events-none" style={{ transform: `rotate(${-item.rotation}deg)` }}>
                  {l!.warnings > 0 && <span title="Guests needing a second look" className="h-5 min-w-5 px-1 rounded-full bg-clay-500 text-paper text-[10px] font-semibold flex items-center justify-center">!</span>}
                  {l!.pending > 0 && <span title="Changes awaiting approval" className="h-5 min-w-5 px-1 rounded-full bg-brass-400 text-ink text-[10px] font-semibold flex items-center justify-center">+{l!.pending}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

/** Chair dots around a table: filled for taken seats, red if over. Capped so a huge table stays readable. */
function Chairs({ item, used, over }: { item: SeatingItem; used: number; over: boolean }) {
  const n = Math.min(item.capacity ?? 0, 30);
  if (n === 0) return null;
  const C = 14, gap = 6;
  const spots: { x: number; y: number }[] = [];
  const w = item.width, h = item.height;
  if (item.shape === "round") {
    const r = Math.max(w, h) / 2 + gap + C / 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      spots.push({ x: w / 2 + Math.cos(a) * r, y: h / 2 + Math.sin(a) * r });
    }
  } else if (item.shape === "head") {
    for (let i = 0; i < n; i++) spots.push({ x: ((i + 0.5) / n) * w, y: -gap - C / 2 });
  } else if (item.shape === "square") {
    // Round-robin across the four sides.
    const sides = [0, 1, 2, 3].map((s) => Math.floor(n / 4) + (s < n % 4 ? 1 : 0));
    sides.forEach((count, s) => {
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count;
        spots.push([{ x: t * w, y: -gap - C / 2 }, { x: w + gap + C / 2, y: t * h }, { x: (1 - t) * w, y: h + gap + C / 2 }, { x: -gap - C / 2, y: (1 - t) * h }][s]);
      }
    });
  } else {
    const top = Math.ceil(n / 2), bottom = n - top;
    for (let i = 0; i < top; i++) spots.push({ x: ((i + 0.5) / top) * w, y: -gap - C / 2 });
    for (let i = 0; i < bottom; i++) spots.push({ x: ((i + 0.5) / bottom) * w, y: h + gap + C / 2 });
  }
  return (
    <>
      {spots.map((s, i) => (
        <span
          key={i}
          className={cn("absolute rounded-full border pointer-events-none",
            i < used ? (over ? "bg-clay-500 border-clay-600" : "bg-wine-400 border-wine-500") : "bg-white border-ink/25")}
          style={{ width: C, height: C, left: s.x - C / 2, top: s.y - C / 2 }}
        />
      ))}
    </>
  );
}
