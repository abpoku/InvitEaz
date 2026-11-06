"use client";

import { forwardRef, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  clampGroupDelta, floorSize, itemLayer, itemsInRect, structureFromDrag, GRID, UNLABELED_SHAPES,
  type Box, type SeatingItem,
} from "@/lib/seating";
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
  selected: Set<string>;
  canEditLayout: boolean;
  seatMode: boolean;           // guests are selected: clicking a table seats them
  drawTool: string | null;     // a structure shape being drawn, or null
  look: (table: SeatingItem) => TableLook;
  onSelect: (ids: Set<string>) => void;
  onSeatSelected: (tableId: string) => void;
  onDropGuests: (ids: string[], tableId: string) => void;
  onMove: (moves: { id: string; x: number; y: number }[]) => void;
  onDraw: (shape: string, box: Box) => void;
}

type Gesture =
  | { kind: "drag"; ids: string[]; hit: string; additive: boolean; px: number; py: number; orig: Map<string, { x: number; y: number }>; moved: boolean }
  | { kind: "marquee"; x0: number; y0: number; additive: boolean; moved: boolean }
  | { kind: "draw"; shape: string; x0: number; y0: number };

/** The floor: tables and room items at their saved positions, scaled by `zoom`.
 *
 * Owner/admin: click selects one item; Shift/⌘/Ctrl-click adds or removes; dragging on empty floor
 * draws a selection box; dragging any selected item moves the whole selection (arrow keys are handled
 * by SeatingManager). With a Draw tool on, dragging on the floor draws that structure instead.
 * Everyone: guests are dropped onto tables with native drag-and-drop from the guest panel, or seated
 * by selecting them and clicking a table — the tap path phones and keyboards use. */
export const FloorPlan = forwardRef<HTMLDivElement, Props>(function FloorPlan(
  { items, zoom, selected, canEditLayout, seatMode, drawTool, look, onSelect, onSeatSelected, onDropGuests, onMove, onDraw }, exportRef
) {
  const gesture = useRef<Gesture | null>(null);
  const layer = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState<{ ids: Set<string>; dx: number; dy: number } | null>(null);
  const [marquee, setMarquee] = useState<{ left: number; top: number; right: number; bottom: number } | null>(null);
  const [preview, setPreview] = useState<{ shape: string; box: Box } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const size = floorSize(items);
  const ordered = [...items].sort((a, b) => itemLayer(a) - itemLayer(b));

  /** Pointer position in floor units. */
  function floorPoint(e: React.PointerEvent) {
    const r = layer.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  }
  const additiveKey = (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => e.shiftKey || e.metaKey || e.ctrlKey;

  // ----- items -----
  function itemDown(e: React.PointerEvent, item: SeatingItem) {
    e.stopPropagation();
    if (!canEditLayout || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const additive = additiveKey(e);
    // Dragging a selected item carries the whole selection; an unselected one moves alone (or joins
    // the selection when a modifier is held).
    const ids = selected.has(item.id) ? [...selected] : additive ? [...selected, item.id] : [item.id];
    const orig = new Map(items.filter((i) => ids.includes(i.id)).map((i) => [i.id, { x: i.x, y: i.y }]));
    gesture.current = { kind: "drag", ids, hit: item.id, additive, px: e.clientX, py: e.clientY, orig, moved: false };
  }

  function itemUp(item: SeatingItem) {
    const g = gesture.current;
    gesture.current = null;
    if (!canEditLayout) return activate(item, false);
    if (!g || g.kind !== "drag") return;
    if (g.moved && offset) {
      onMove(g.ids.map((id) => ({ id, x: g.orig.get(id)!.x + offset.dx, y: g.orig.get(id)!.y + offset.dy })));
      setOffset(null);
      if (!selected.has(item.id)) onSelect(new Set(g.ids));
      return;
    }
    activate(item, g.additive);
  }

  function activate(item: SeatingItem, additive: boolean) {
    if (additive && canEditLayout) {
      const next = new Set(selected);
      if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
      onSelect(next);
    } else if (seatMode && item.kind === "table") {
      onSeatSelected(item.id);
    } else {
      onSelect(new Set([item.id]));
    }
  }

  // ----- floor background: selection box, or drawing -----
  function floorDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const p = floorPoint(e);
    if (drawTool && canEditLayout) {
      e.currentTarget.setPointerCapture(e.pointerId);
      gesture.current = { kind: "draw", shape: drawTool, x0: p.x, y0: p.y };
      setPreview({ shape: drawTool, box: structureFromDrag(drawTool, p.x, p.y, p.x, p.y) });
      return;
    }
    // On touch, dragging the empty floor scrolls it; the selection box is for mouse/pen.
    if (e.pointerType === "touch") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { kind: "marquee", x0: p.x, y0: p.y, additive: additiveKey(e), moved: false };
  }

  function move(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "drag") {
      const dx = (e.clientX - g.px) / zoom, dy = (e.clientY - g.py) / zoom;
      if (!g.moved && Math.hypot(dx, dy) < 4) return;
      g.moved = true;
      const d = clampGroupDelta([...g.orig.values()], dx, dy);
      setOffset({ ids: new Set(g.ids), ...d });
    } else if (g.kind === "marquee") {
      const p = floorPoint(e);
      if (!canEditLayout || (!g.moved && Math.hypot(p.x - g.x0, p.y - g.y0) < 4)) return;
      g.moved = true;
      setMarquee({ left: Math.min(g.x0, p.x), top: Math.min(g.y0, p.y), right: Math.max(g.x0, p.x), bottom: Math.max(g.y0, p.y) });
    } else {
      const p = floorPoint(e);
      setPreview({ shape: g.shape, box: structureFromDrag(g.shape, g.x0, g.y0, p.x, p.y) });
    }
  }

  function floorUp(e: React.PointerEvent) {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind === "draw") {
      const p = floorPoint(e);
      setPreview(null);
      onDraw(g.shape, structureFromDrag(g.shape, g.x0, g.y0, p.x, p.y));
    } else if (g.kind === "marquee") {
      if (g.moved && marquee && canEditLayout) {
        const hit = itemsInRect(items, marquee);
        onSelect(new Set(g.additive ? [...selected, ...hit] : hit));
      } else if (!g.additive) {
        onSelect(new Set());
      }
      setMarquee(null);
    }
  }

  function cancel() {
    gesture.current = null;
    setOffset(null);
    setMarquee(null);
    setPreview(null);
  }

  return (
    <div style={{ width: size.width * zoom, height: size.height * zoom }} className="relative">
      <div
        ref={(el) => {
          layer.current = el;
          if (typeof exportRef === "function") exportRef(el);
          else if (exportRef) exportRef.current = el;
        }}
        onPointerDown={floorDown}
        onPointerMove={move}
        onPointerUp={floorUp}
        onPointerCancel={cancel}
        className={cn("absolute left-0 top-0 origin-top-left bg-white select-none", drawTool && "cursor-crosshair touch-none")}
        style={{
          width: size.width, height: size.height, transform: `scale(${zoom})`,
          backgroundImage: "linear-gradient(#EFE9DB 1px, transparent 1px), linear-gradient(90deg, #EFE9DB 1px, transparent 1px)",
          backgroundSize: `${GRID * 4}px ${GRID * 4}px`,
        }}
      >
        {ordered.map((item) => {
          const shifted = offset?.ids.has(item.id);
          const pos = shifted ? { x: item.x + offset!.dx, y: item.y + offset!.dy } : item;
          const isTable = item.kind === "table";
          const l = isTable ? look(item) : null;
          const over = !!l && item.capacity !== null && l.used > item.capacity;
          const full = !!l && item.capacity !== null && !over && l.used >= item.capacity && item.capacity > 0;
          const isSelected = selected.has(item.id);
          return (
            <div
              key={item.id}
              data-item-id={item.id}
              role="button"
              tabIndex={0}
              aria-label={isTable ? `${item.label}, ${l!.used} of ${item.capacity ?? "unlimited"} seats taken` : item.label}
              aria-pressed={isSelected}
              onPointerDown={(e) => itemDown(e, item)}
              onPointerMove={move}
              onPointerUp={() => itemUp(item)}
              onPointerCancel={cancel}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(item, e.shiftKey); } }}
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
                "absolute touch-none outline-none",
                drawTool && "pointer-events-none",
                canEditLayout ? (shifted ? "cursor-grabbing z-20" : "cursor-grab") : "cursor-pointer",
                isTable && !l!.enabled && "opacity-45",
              )}
              style={{ left: pos.x, top: pos.y, width: item.width, height: item.height, transform: `rotate(${item.rotation}deg)` }}
            >
              {isTable ? (
                <>
                  <Chairs item={item} used={l!.used} over={over} />
                  <div
                    className={cn(
                      "absolute inset-0 flex items-center justify-center text-center border-2 transition-shadow",
                      item.shape === "round" ? "rounded-full" : "rounded-md",
                      over ? "bg-[#F6E3DE] border-clay-500" : full ? "bg-brass-50" : "bg-white",
                      isSelected && "ring-2 ring-wine-500 ring-offset-2",
                      hover === item.id && "ring-2 ring-moss-400 ring-offset-2",
                      seatMode && l!.enabled && "hover:ring-2 hover:ring-moss-400",
                    )}
                    style={!over ? { borderColor: l!.color || "rgba(30,34,51,0.25)" } : undefined}
                  >
                    {/* Text stays upright however the table is rotated. */}
                    <div style={{ transform: `rotate(${-item.rotation}deg)` }} className="px-1 leading-tight pointer-events-none">
                      <p className="font-medium text-ink text-xs">{item.label}</p>
                      <p className={cn("text-[11px] tabular-nums", over ? "text-clay-600 font-semibold" : "text-ink-faint")}>{l!.used}/{item.capacity ?? "∞"}</p>
                    </div>
                  </div>
                  {(l!.pending > 0 || l!.warnings > 0) && (
                    <div className="absolute -top-2 -right-2 flex gap-0.5 pointer-events-none" style={{ transform: `rotate(${-item.rotation}deg)` }}>
                      {l!.warnings > 0 && <span title="Guests needing a second look" className="h-5 min-w-5 px-1 rounded-full bg-clay-500 text-paper text-[10px] font-semibold flex items-center justify-center">!</span>}
                      {l!.pending > 0 && <span title="Changes awaiting approval" className="h-5 min-w-5 px-1 rounded-full bg-brass-400 text-ink text-[10px] font-semibold flex items-center justify-center">+{l!.pending}</span>}
                    </div>
                  )}
                </>
              ) : (
                <Fixture item={item} selected={isSelected} />
              )}
            </div>
          );
        })}

        {preview && (
          <div className="absolute pointer-events-none opacity-60" style={{ left: preview.box.x, top: preview.box.y, width: preview.box.width, height: preview.box.height, transform: `rotate(${preview.box.rotation}deg)` }}>
            <Fixture item={{ shape: preview.shape, label: "", width: preview.box.width, height: preview.box.height, rotation: preview.box.rotation }} selected={false} />
          </div>
        )}
        {marquee && (
          <div className="absolute pointer-events-none border border-wine-500 bg-wine-500/10"
            style={{ left: marquee.left, top: marquee.top, width: marquee.right - marquee.left, height: marquee.bottom - marquee.top }} />
        )}
      </div>
    </div>
  );
});

/** Room items and structures, drawn as floor-plan symbols. */
function Fixture({ item, selected }: { item: Pick<SeatingItem, "shape" | "label" | "width" | "height" | "rotation">; selected: boolean }) {
  const ring = selected && "ring-2 ring-wine-500 ring-offset-2";
  const label = !UNLABELED_SHAPES.has(item.shape) && item.label && (
    <div style={{ transform: `rotate(${-item.rotation}deg)` }} className="px-1 leading-tight pointer-events-none">
      <p className="text-[11px] italic text-ink-soft">{item.label}</p>
    </div>
  );
  switch (item.shape) {
    case "wall":
      return <div className={cn("absolute inset-0 bg-ink/80 rounded-[1px]", ring)} />;
    case "window":
      // Two thin panes with glass between — the usual plan symbol.
      return <div className={cn("absolute inset-0 border-y-2 border-[#3A6EA5] bg-[#DCEBF7]", ring)}><div className="absolute left-0 right-0 top-1/2 h-px bg-[#3A6EA5]" /></div>;
    case "door":
      return (
        <div className={cn("absolute inset-0 bg-white border border-ink/40", ring)}>
          {/* Leaf standing open from the left jamb, with its swing arc. */}
          <svg className="absolute left-0 bottom-full overflow-visible pointer-events-none" width={item.width} height={item.width} aria-hidden="true">
            <line x1="0" y1={item.width} x2="0" y2="0" stroke="#4A4F63" strokeWidth="2" />
            <path d={`M 0 0 A ${item.width} ${item.width} 0 0 1 ${item.width} ${item.width}`} fill="none" stroke="#83879A" strokeWidth="1" strokeDasharray="4 3" />
          </svg>
        </div>
      );
    case "pillar":
      return <div className={cn("absolute inset-0 bg-ink/60 rounded-sm", ring)} />;
    case "stairs":
      return (
        <div className={cn("absolute inset-0 flex items-center justify-center border-2 border-ink/40 bg-white", ring)}
          style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent 0 14px, rgba(30,34,51,0.35) 14px 16px)" }}>
          {label}
        </div>
      );
    case "area":
      return (
        <div className={cn("absolute inset-0 border-2 border-dashed border-ink/25 bg-ink/[0.03] rounded-md", ring)}>
          <div className="absolute left-2 top-1.5" style={{ transform: `rotate(${-item.rotation}deg)` }}>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint pointer-events-none">{item.label}</p>
          </div>
        </div>
      );
    default:
      return (
        <div className={cn(
          "absolute inset-0 flex items-center justify-center text-center border-2 rounded-sm border-dashed",
          item.shape === "stage" ? "bg-ink/10 border-ink/30" : item.shape === "dance_floor" ? "bg-wine-50 border-wine-200" : "bg-paper-soft border-ink/25",
          ring,
        )}>
          {label}
        </div>
      );
  }
}

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
