"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { GripHorizontal } from "lucide-react";
import { choosePanelSpot, type Rect, type Spot } from "./panel-placement";

const PANEL_W = 288; // w-72
const MARGIN = 10;   // breathing room kept clear around the item

/** On-screen footprint of a floor item — the element plus everything drawn outside its box (chairs,
 * a door's swing arc, badges, handles) — relative to `wrap`, clipped to the visible floor. Null when
 * the item is scrolled out of view. */
function itemRect(wrap: HTMLElement, scroll: HTMLElement, id: string): Rect | null {
  const el = scroll.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(id)}"]`);
  if (!el) return null;
  let r: Rect | null = null;
  for (const node of [el, ...Array.from(el.querySelectorAll<Element>("*"))]) {
    const b = node.getBoundingClientRect();
    if (!b.width && !b.height) continue;
    r = r ? { left: Math.min(r.left, b.left), top: Math.min(r.top, b.top), right: Math.max(r.right, b.right), bottom: Math.max(r.bottom, b.bottom) }
      : { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
  }
  if (!r) return null;
  const w = wrap.getBoundingClientRect(), v = scroll.getBoundingClientRect();
  const clip = { left: Math.max(r.left, v.left), top: Math.max(r.top, v.top), right: Math.min(r.right, v.right), bottom: Math.min(r.bottom, v.bottom) };
  if (clip.right <= clip.left || clip.bottom <= clip.top) return null;
  return { left: clip.left - w.left - MARGIN, top: clip.top - w.top - MARGIN, right: clip.right - w.left + MARGIN, bottom: clip.bottom - w.top + MARGIN };
}

/** The inspector floating over the floor plan. It goes wherever it won't cover the selected item —
 * a corner, or beside the item — and moves out of the way when the item, zoom or scroll changes.
 * The planner can drag it by its grip; dropped on top of the item, it slides to the nearest clear
 * spot. While the item is being dragged or reshaped it fades out. If no spot is clear (a huge item
 * at high zoom), `onDocked(true)` tells the parent to show it below the floor instead. */
export function FloatingInspector({ wrapRef, scrollRef, itemId, layoutKey, hidden, onDocked, children }: {
  wrapRef: React.RefObject<HTMLDivElement>;
  scrollRef: React.RefObject<HTMLDivElement>;
  itemId: string;
  layoutKey: string;   // changes whenever the item's position/size/zoom might have changed
  hidden: boolean;
  onDocked: (docked: boolean) => void;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const userSpot = useRef<Spot | null>(null);
  const lastH = useRef(480);
  const drag = useRef<{ px: number; py: number; left: number; top: number } | null>(null);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [maxH, setMaxH] = useState<number | undefined>();

  const measure = useCallback(() => {
    const wrap = wrapRef.current, scroll = scrollRef.current;
    if (!wrap || !scroll) return null;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const ph = Math.min(panel.current?.scrollHeight || lastH.current, H - 16);
    if (panel.current) lastH.current = panel.current.scrollHeight;
    return { W, H, pw: PANEL_W, ph, item: itemRect(wrap, scroll, itemId) };
  }, [wrapRef, scrollRef, itemId]);

  const place = useCallback(() => {
    if (drag.current) return;
    const m = measure();
    if (!m) return;
    setMaxH(m.H - 16);
    const s = choosePanelSpot({ ...m, preferred: userSpot.current });
    setSpot(s);
    onDocked(!s);
  }, [measure, onDocked]);

  useLayoutEffect(() => { if (!hidden) place(); }, [place, layoutKey, hidden]);
  useEffect(() => {
    const scroll = scrollRef.current;
    const ro = new ResizeObserver(() => place());
    if (panel.current) ro.observe(panel.current);
    if (wrapRef.current) ro.observe(wrapRef.current);
    scroll?.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    return () => { ro.disconnect(); scroll?.removeEventListener("scroll", place); window.removeEventListener("resize", place); };
  }, [place, scrollRef, wrapRef, spot === null]); // eslint-disable-line react-hooks/exhaustive-deps

  function gripDown(e: React.PointerEvent) {
    if (!spot || e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, left: spot.left, top: spot.top };
  }
  function gripMove(e: React.PointerEvent) {
    const g = drag.current, wrap = wrapRef.current;
    if (!g || !wrap) return;
    const W = wrap.clientWidth, H = wrap.clientHeight, ph = panel.current?.offsetHeight || 0;
    setSpot({
      left: Math.min(Math.max(8, g.left + e.clientX - g.px), W - PANEL_W - 8),
      top: Math.min(Math.max(8, g.top + e.clientY - g.py), H - ph - 8),
    });
  }
  function gripUp() {
    if (!drag.current) return;
    drag.current = null;
    const m = measure();
    if (!m || !spot) return;
    // Keep it where it was dropped unless that covers the item; then the nearest clear spot.
    const s = choosePanelSpot({ ...m, preferred: spot, nearTo: spot });
    userSpot.current = s;
    setSpot(s);
    onDocked(!s);
  }

  if (!spot) return null;
  return (
    <div
      ref={panel}
      data-floating-inspector
      className="absolute z-40 w-72 overflow-y-auto rounded-lg shadow-lifted bg-white transition-opacity"
      style={{ left: spot.left, top: spot.top, maxHeight: maxH, opacity: hidden ? 0 : 1, pointerEvents: hidden ? "none" : undefined }}
    >
      <div
        onPointerDown={gripDown} onPointerMove={gripMove} onPointerUp={gripUp} onPointerCancel={gripUp}
        className="sticky top-0 z-10 flex items-center justify-center gap-1.5 py-1 bg-paper-soft border-b border-paper-line rounded-t-lg cursor-move touch-none text-[11px] text-ink-faint select-none"
        title="Drag to move this panel"
      >
        <GripHorizontal className="h-3.5 w-3.5" aria-hidden="true" /> Drag to move
      </div>
      {children}
    </div>
  );
}
