"use client";

import { useState } from "react";
import { cn, fullName } from "@/lib/utils";
import { FIXTURE_SHAPES, LINE_SHAPES, TABLE_SHAPES, WARNING_TEXT, guestWarning, seatsFor, type SeatingGuest, type SeatingItem } from "@/lib/seating";
import { GUEST_DRAG, type SeatingRequest } from "./types";

interface Props {
  item: SeatingItem;
  canEditLayout: boolean;
  canSeat: boolean;
  clones: { id: string; name: string }[];
  isScoped: boolean;
  seated: SeatingGuest[];          // the guests at this table the viewer may see
  usage: { seats: number; guests: number };
  incoming: SeatingRequest[];      // pending moves onto this table
  tableLabel: (id: string | null) => string;
  onPatch: (patch: Partial<SeatingItem>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onUnseat: (ids: string[]) => void;
  onClose: () => void;
}

/** Details for the selected table/fixture: who's seated (with anything that needs a second look),
 * moves waiting on approval, and — for owner/admin — its name, size, shape, capacity and clone. */
export function TableInspector({ item, canEditLayout, canSeat, clones, isScoped, seated, usage, incoming, tableLabel, onPatch, onDuplicate, onDelete, onUnseat, onClose }: Props) {
  const isTable = item.kind === "table";
  const line = LINE_SHAPES.has(item.shape);
  const shapes = isTable ? TABLE_SHAPES : FIXTURE_SHAPES;
  const [label, setLabel] = useState(item.label);
  const [capacity, setCapacity] = useState(item.capacity === null ? "" : String(item.capacity));
  const [width, setWidth] = useState(String(item.width));
  const [height, setHeight] = useState(String(item.height));
  const hidden = usage.guests - seated.length;
  const over = item.capacity !== null && usage.seats > item.capacity;
  const cloneName = item.assembly_id ? clones.find((c) => c.id === item.assembly_id)?.name || "another clone" : null;

  function commitNumber(raw: string, key: "capacity" | "width" | "height", min: number) {
    const n = Math.round(Number(raw));
    if (raw.trim() === "" && key === "capacity") return onPatch({ capacity: null });
    if (!Number.isFinite(n) || n < min) return;
    if (n !== item[key]) onPatch({ [key]: n });
  }

  return (
    <div className="card p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-serif text-lg text-ink truncate">{item.label}</p>
          <p className="text-xs text-ink-faint">
            {shapes[item.shape]?.label}
            {isTable && <> · <span className={cn(over && "text-clay-600 font-semibold")}>{usage.seats}/{item.capacity ?? "∞"} seats</span></>}
            {cloneName && <> · set aside for {cloneName}</>}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close" className="h-8 w-8 -mr-1 -mt-1 flex items-center justify-center text-ink-faint hover:text-ink text-xl leading-none">×</button>
      </div>

      {isTable && (
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-faint">Seated</p>
          {over && <p className="mt-1 text-xs text-clay-600">Over capacity by {usage.seats - item.capacity!} — move someone or raise the capacity.</p>}
          <ul className="mt-1.5 space-y-1">
            {seated.map((g) => {
              const w = guestWarning(g, item);
              const seats = seatsFor(g);
              return (
                <li
                  key={g.id}
                  draggable={canSeat}
                  onDragStart={(e) => { e.dataTransfer.setData(GUEST_DRAG, JSON.stringify([g.id])); e.dataTransfer.effectAllowed = "move"; }}
                  className={cn("flex items-center gap-2 text-sm rounded px-1.5 py-1", canSeat && "cursor-grab hover:bg-paper-soft")}
                >
                  <span className="truncate text-ink">{fullName(g.first_name, g.last_name)}</span>
                  {seats > 1 && <span className="chip bg-ink/5 text-ink-soft">+{seats - 1}</span>}
                  {w && <span title={WARNING_TEXT[w]} className="chip bg-clay-500/10 text-clay-600">{w === "other_clone" ? "Other clone" : w === "no_response" ? "No response" : w === "maybe" ? "Maybe" : "Declined"}</span>}
                  {canSeat && (
                    <button onClick={() => onUnseat([g.id])} className="ml-auto text-xs text-ink-faint hover:text-clay-600 shrink-0"
                      title={isScoped ? "Ask the owner to unseat" : "Unseat"}>
                      {isScoped ? "Ask to unseat" : "Unseat"}
                    </button>
                  )}
                </li>
              );
            })}
            {hidden > 0 && <li className="text-xs text-ink-faint px-1.5">+{hidden} guest{hidden === 1 ? "" : "s"} from other clones</li>}
            {usage.guests === 0 && <li className="text-sm text-ink-faint px-1.5">Nobody yet — drag guests here.</li>}
          </ul>
          {incoming.length > 0 && (
            <div className="mt-3">
              <p className="text-xs uppercase tracking-wide text-ink-faint">Awaiting approval</p>
              <ul className="mt-1.5 space-y-1">
                {incoming.map((r) => (
                  <li key={r.id} className="text-sm rounded border border-dashed border-brass-300 px-2 py-1 text-ink-soft">
                    {r.invitee_name} <span className="text-xs text-ink-faint">from {tableLabel(r.from_table_id)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {canEditLayout && (
        <div className="pt-3 border-t border-paper-line space-y-3">
          <div>
            <label className="label">Name</label>
            <input className="input py-1.5" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)}
              onBlur={() => { if (label.trim() && label.trim() !== item.label) onPatch({ label: label.trim() }); else setLabel(item.label); }} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Shape</label>
              <select className="input py-1.5" value={item.shape} onChange={(e) => onPatch({ shape: e.target.value })}>
                {Object.entries(shapes).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
              </select>
            </div>
            {isTable && (
              <div>
                <label className="label">Seats</label>
                <input className="input py-1.5" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value.replace(/\D/g, ""))}
                  onBlur={() => commitNumber(capacity, "capacity", 0)} />
              </div>
            )}
            <div>
              <label className="label">{line ? "Length" : "Width"}</label>
              <input className="input py-1.5" inputMode="numeric" value={width} onChange={(e) => setWidth(e.target.value.replace(/\D/g, ""))} onBlur={() => commitNumber(width, "width", 4)} />
            </div>
            <div>
              <label className="label">{line ? "Thickness" : "Length"}</label>
              <input className="input py-1.5" inputMode="numeric" value={height} onChange={(e) => setHeight(e.target.value.replace(/\D/g, ""))} onBlur={() => commitNumber(height, "height", 4)} />
            </div>
          </div>
          {isTable && clones.length > 0 && (
            <div>
              <label className="label">Set aside for clone</label>
              <select className="input py-1.5" value={item.assembly_id || ""} onChange={(e) => onPatch({ assembly_id: e.target.value || null })}>
                <option value="">No clone (owner/admin seat it)</option>
                {clones.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <p className="mt-1 text-xs text-ink-faint">That clone&apos;s planners can seat their guests here.</p>
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-ink-soft">Rotate</span>
            <button className="btn-secondary py-1 px-2 text-xs" onClick={() => onPatch({ rotation: (item.rotation - 15) % 360 })}>⟲ 15°</button>
            <button className="btn-secondary py-1 px-2 text-xs" onClick={() => onPatch({ rotation: (item.rotation + 15) % 360 })}>⟳ 15°</button>
            {item.rotation !== 0 && <button className="btn-ghost py-1 px-2 text-xs" onClick={() => onPatch({ rotation: 0 })}>Reset</button>}
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary py-1.5 text-sm" onClick={onDuplicate}>Duplicate</button>
            <button className="btn-ghost py-1.5 text-sm text-clay-600 hover:text-clay-600" onClick={onDelete}>Delete</button>
          </div>
          <p className="text-[11px] text-ink-faint">Tip: drag to move; arrow keys nudge (Shift for bigger steps).</p>
        </div>
      )}
    </div>
  );
}
