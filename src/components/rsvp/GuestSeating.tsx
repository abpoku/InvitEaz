"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { itemBounds, itemLayer, SEAT_COLOR, type SeatingItem } from "@/lib/seating";
import { Chairs, Fixture, type Chair } from "@/components/seating/FloorPlan";
import type { GuestSeating } from "@/lib/models/seating";

/** The guest's table(s) on their invitation link: the table name, who else sits there, and where it
 * is in the room. Only shown once the planner shares seating (see guestSeatingFor). On a household
 * link each table also lists which of the household sit there. */
export function GuestSeatingCard({ seating, household }: { seating: GuestSeating; household?: boolean }) {
  const [showFloor, setShowFloor] = useState(true);
  const single = seating.tables.length === 1;
  return (
    <div className="card p-6 mt-4">
      <p className="text-xs uppercase tracking-wide text-ink-faint">{household ? "Your seating" : single ? "Your table" : "Your tables"}</p>
      <div className="mt-2 space-y-4">
        {seating.tables.map((t) => {
          const ours = t.guests.filter((g) => g.ours).map((g) => g.name);
          const mates = t.guests.filter((g) => !g.ours).map((g) => g.name);
          return (
            <div key={t.id}>
              <p className="font-serif text-2xl text-wine-700 leading-tight">{t.label}</p>
              {household && ours.length > 0 && <p className="mt-0.5 text-sm text-ink">{ours.join(", ")}</p>}
              {mates.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs text-ink-faint">{household ? "Also at this table" : "Also at your table"}</p>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {mates.map((g, i) => <li key={i} className="chip bg-paper-soft text-ink-soft">{g}</li>)}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {seating.floor.length > 1 && (
        <div className="mt-5">
          <button onClick={() => setShowFloor((v) => !v)} className="text-sm text-wine-600 hover:underline">
            {showFloor ? "Hide the floor plan" : `Show where ${single ? "it is" : "they are"} in the room`}
          </button>
          {showFloor && <GuestFloor floor={seating.floor} />}
        </div>
      )}
    </div>
  );
}

const PAD = 40;
const PIN_SPACE = 34; // screen px kept clear above the floor for the "Your table" pins

/** Read-only floor: the room as the planner laid it out, the guest's table(s) highlighted and every
 * other table blurred. Fits the card's width, with zoom buttons; opens centred on the guest's table. */
function GuestFloor({ floor }: { floor: GuestSeating["floor"] }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [zoomBy, setZoomBy] = useState(1);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Bounds of everything, with room for chairs around the edge.
  const b = floor.reduce((acc, i) => {
    const r = itemBounds(i);
    return { left: Math.min(acc.left, r.left), top: Math.min(acc.top, r.top), right: Math.max(acc.right, r.right), bottom: Math.max(acc.bottom, r.bottom) };
  }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  const left = b.left - PAD, top = b.top - PAD;
  const w = b.right - b.left + PAD * 2, h = b.bottom - b.top + PAD * 2;
  const fit = width ? Math.min(1, width / w) : 0;
  const scale = fit * zoomBy;
  const ordered = [...floor].sort((a, c) => itemLayer(a) - itemLayer(c));

  // Keep the guest's table in view whenever the zoom changes.
  useLayoutEffect(() => {
    const el = box.current, mine = floor.find((i) => i.mine);
    if (!el || !mine || !scale) return;
    const r = itemBounds(mine);
    el.scrollLeft = ((r.left + r.right) / 2 - left) * scale - el.clientWidth / 2;
    el.scrollTop = ((r.top + r.bottom) / 2 - top) * scale + PIN_SPACE - el.clientHeight / 2;
  }, [scale]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mt-3">
      <div ref={box} className="relative overflow-auto rounded border border-paper-line bg-white max-h-[70vh]">
        {scale > 0 && (
          <div style={{ width: w * scale, height: h * scale + PIN_SPACE }} className="relative">
            <div className="absolute left-0 origin-top-left select-none" style={{ top: PIN_SPACE, width: w, height: h, transform: `scale(${scale}) translate(${-left}px, ${-top}px)` }}>
              {ordered.map((i) => {
                const style = { left: i.x, top: i.y, width: i.width, height: i.height, transform: `rotate(${i.rotation}deg)` };
                if (i.kind !== "table") {
                  return <div key={i.id} className="absolute pointer-events-none" style={style}><Fixture item={i} selected={false} /></div>;
                }
                const chairs: Chair[] = Array.from({ length: i.taken }, () => ({ color: SEAT_COLOR, label: null }));
                return (
                  <div key={i.id} className={cn("absolute", !i.mine && "opacity-60 blur-[2px]", i.mine && "z-10")} style={style}>
                    <Chairs item={{ ...i, assembly_id: null } as SeatingItem} chairs={chairs} showNames={false} zoom={1} />
                    <div className={cn(
                      "absolute inset-0 flex items-center justify-center text-center border-2",
                      i.shape === "round" ? "rounded-full" : "rounded-md",
                      i.mine ? "bg-wine-50 border-wine-500 ring-4 ring-wine-300/60 ring-offset-2" : "bg-white border-ink/20",
                    )}>
                      {i.mine && (
                        <p style={{ transform: `rotate(${-i.rotation}deg)` }} className="px-1 text-sm font-semibold leading-tight text-wine-700">{i.label}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Pins in screen space, so they stay readable at any zoom and never get cut off. */}
            {floor.filter((i) => i.mine).map((i) => {
              const r = itemBounds(i);
              const chairs = 28; // chair ring above the table edge, in floor units
              return (
                <span key={i.id} className="absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full bg-wine-600 px-2.5 py-1 text-xs font-semibold text-paper shadow pointer-events-none"
                  style={{ left: Math.min(w * scale - 48, Math.max(48, ((r.left + r.right) / 2 - left) * scale)), top: Math.max(PIN_SPACE - 4, (r.top - chairs - top) * scale + PIN_SPACE - 4) }}>
                  Your table
                </span>
              );
            })}
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-ink-faint">
        <span>{floor.filter((i) => i.mine).length > 1 ? "Your tables are" : "Your table is"} highlighted; other tables are blurred.</span>
        <div className="flex items-center gap-1 shrink-0">
          <button className="btn-ghost h-8 w-8 p-0" aria-label="Zoom out" disabled={zoomBy <= 1} onClick={() => setZoomBy((z) => Math.max(1, z / 1.5))}>−</button>
          <button className="btn-ghost h-8 w-8 p-0" aria-label="Zoom in" disabled={zoomBy >= 4} onClick={() => setZoomBy((z) => Math.min(4, z * 1.5))}>+</button>
        </div>
      </div>
    </div>
  );
}
