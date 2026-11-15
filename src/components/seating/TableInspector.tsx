"use client";

import { useState } from "react";
import { cn, fullName } from "@/lib/utils";
import { COLORED_SHAPES, DEFAULT_ITEM_COLOR, FIXTURE_SHAPES, ITEM_COLORS, LINE_SHAPES, TABLE_SHAPES, WARNING_TEXT, shapeFamily, guestWarning, seatsFor, type SeatingGuest, type SeatingItem } from "@/lib/seating";
import { GUEST_DRAG, type SeatingRequest } from "./types";

interface Props {
  item: SeatingItem;
  canEditLayout: boolean;
  canSeat: boolean;
  clones: { id: string; name: string }[];
  isScoped: boolean;
  seated: SeatingGuest[];          // the guests at this table the viewer may see
  otherTables: { id: string; label: string; used: number; capacity: number | null }[]; // tables the viewer can seat at
  guestsAt: (tableId: string) => SeatingGuest[];
  canSwap: boolean;                // owner/admin
  usage: { seats: number; guests: number };
  incoming: SeatingRequest[];      // pending moves onto this table
  tableLabel: (id: string | null) => string;
  onPatch: (patch: Partial<SeatingItem>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onUnseat: (ids: string[]) => void;
  onMoveTo: (ids: string[], tableId: string) => void;
  onSwap: (here: string[], there: string[]) => Promise<boolean>;
  onClose: () => void;
}

/** Details for the selected table/fixture: who's seated (with anything that needs a second look),
 * moves waiting on approval, and — for owner/admin — its name, size, shape, capacity and clone. */
export function TableInspector({ item, canEditLayout, canSeat, clones, isScoped, seated, otherTables, guestsAt, canSwap, usage, incoming, tableLabel, onPatch, onDuplicate, onDelete, onUnseat, onMoveTo, onSwap, onClose }: Props) {
  const isTable = item.kind === "table";
  const line = LINE_SHAPES.has(item.shape);
  const isText = item.shape === "text";
  const shapes = isTable ? TABLE_SHAPES : Object.fromEntries(shapeFamily(item.shape).map((k) => [k, FIXTURE_SHAPES[k]]));
  const [label, setLabel] = useState(item.label);
  const [capacity, setCapacity] = useState(item.capacity === null ? "" : String(item.capacity));
  const [width, setWidth] = useState(String(item.width));
  const [height, setHeight] = useState(String(item.height));
  const hidden = usage.guests - seated.length;
  // Guests picked in the Seated list, for Unseat / Move / Swap. Anyone who has left the table drops out.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const chosen = seated.filter((g) => picked.has(g.id));
  const allPicked = seated.length > 0 && chosen.length === seated.length;
  const [swapTable, setSwapTable] = useState<string | null>(null);
  const [swapWith, setSwapWith] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const swapGuests = swapTable ? guestsAt(swapTable) : [];
  const swapChosen = swapGuests.filter((g) => swapWith.has(g.id));
  const toggle = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };
  function done() { setPicked(new Set()); setSwapTable(null); setSwapWith(new Set()); }
  async function doSwap() {
    if (!chosen.length || !swapChosen.length) return;
    setBusy(true);
    const ok = await onSwap(chosen.map((g) => g.id), swapChosen.map((g) => g.id));
    setBusy(false);
    if (ok) done();
  }
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
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-wide text-ink-faint">Seated</p>
            {canSeat && seated.length > 1 && (
              <label className="inline-flex items-center gap-1.5 text-xs text-ink-soft cursor-pointer">
                <input type="checkbox" checked={allPicked} onChange={() => { setPicked(allPicked ? new Set() : new Set(seated.map((g) => g.id))); setSwapTable(null); }} />
                Select all
              </label>
            )}
          </div>
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
                  className={cn("flex items-center gap-2 text-sm rounded px-1.5 py-1", canSeat && "cursor-grab hover:bg-paper-soft", picked.has(g.id) && "bg-wine-50")}
                >
                  {canSeat && (
                    <input type="checkbox" aria-label={`Select ${fullName(g.first_name, g.last_name)}`} checked={picked.has(g.id)}
                      onChange={() => { setPicked((p) => toggle(p, g.id)); setSwapTable(null); }} className="shrink-0" />
                  )}
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
          {canSeat && chosen.length > 0 && (
            <div className="mt-2 rounded border border-wine-100 bg-wine-50/60 p-2 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-wine-700">{chosen.length} selected</span>
                <button className="btn-secondary py-1 px-2 text-xs" disabled={busy}
                  onClick={() => { onUnseat(chosen.map((g) => g.id)); done(); }}>
                  {isScoped ? "Ask to unseat" : "Unseat"}
                </button>
                {otherTables.length > 0 && (
                  <select className="input py-1 text-xs w-auto" value="" disabled={busy} aria-label="Move selected guests to another table"
                    onChange={(e) => { if (e.target.value) { onMoveTo(chosen.map((g) => g.id), e.target.value); done(); } }}>
                    <option value="">{isScoped ? "Ask to move to…" : "Move to…"}</option>
                    {otherTables.map((t) => <option key={t.id} value={t.id}>{t.label} ({t.used}/{t.capacity ?? "∞"})</option>)}
                  </select>
                )}
                {canSwap && otherTables.length > 0 && (
                  <button className={cn("btn-secondary py-1 px-2 text-xs", swapTable !== null && "ring-2 ring-wine-200")} disabled={busy}
                    onClick={() => { setSwapTable(swapTable === null ? "" : null); setSwapWith(new Set()); }}>
                    Swap…
                  </button>
                )}
              </div>
              {swapTable !== null && (
                <div className="space-y-1.5">
                  <select className="input py-1 text-xs" value={swapTable} aria-label="Table to swap with"
                    onChange={(e) => { setSwapTable(e.target.value); setSwapWith(new Set()); }}>
                    <option value="">Swap with guests at…</option>
                    {otherTables.filter((t) => guestsAt(t.id).length > 0).map((t) => <option key={t.id} value={t.id}>{t.label} ({t.used}/{t.capacity ?? "∞"})</option>)}
                  </select>
                  {swapTable && (
                    <>
                      <ul className="max-h-40 overflow-y-auto rounded border border-paper-line bg-white">
                        {swapGuests.map((g) => (
                          <li key={g.id}>
                            <label className="flex items-center gap-2 px-2 py-1 text-sm cursor-pointer hover:bg-paper-soft">
                              <input type="checkbox" checked={swapWith.has(g.id)} onChange={() => setSwapWith((s) => toggle(s, g.id))} />
                              <span className="truncate">{fullName(g.first_name, g.last_name)}</span>
                              {seatsFor(g) > 1 && <span className="chip bg-ink/5 text-ink-soft">+{seatsFor(g) - 1}</span>}
                            </label>
                          </li>
                        ))}
                      </ul>
                      <div className="flex items-center gap-2">
                        <button className="btn-primary py-1 px-2.5 text-xs whitespace-nowrap shrink-0" disabled={busy || swapChosen.length === 0} onClick={doSwap}>
                          {busy ? "Swapping…" : `Swap ${chosen.length} ↔ ${swapChosen.length || "…"}`}
                        </button>
                        <span className="text-[11px] text-ink-faint">Selected guests here go to {tableLabel(swapTable)}; the ones you tick there come here.</span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
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
            <label className="label" htmlFor={`label-${item.id}`}>{isText ? "Text" : "Name"}</label>
            {isText ? (
              // A fresh text box still says "Text": focus it so the planner can type straight away.
              <textarea id={`label-${item.id}`} className="input py-1.5 min-h-[4.5rem]" value={label} maxLength={200} rows={3}
                autoFocus={item.label === FIXTURE_SHAPES.text.label}
                onFocus={(e) => { if (item.label === FIXTURE_SHAPES.text.label) e.currentTarget.select(); }}
                onChange={(e) => setLabel(e.target.value)}
                onBlur={() => { if (label.trim() && label.trim() !== item.label) onPatch({ label: label.trim() }); else setLabel(item.label); }} />
            ) : (
              <input id={`label-${item.id}`} className="input py-1.5" value={label} maxLength={isTable ? 60 : 200} onChange={(e) => setLabel(e.target.value)}
                onBlur={() => { if (label.trim() && label.trim() !== item.label) onPatch({ label: label.trim() }); else setLabel(item.label); }} />
            )}
          </div>
          {COLORED_SHAPES.has(item.shape) && (
            <div>
              <p className="label">Color</p>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Color">
                {ITEM_COLORS.map((c) => {
                  const on = (item.color || DEFAULT_ITEM_COLOR).toLowerCase() === c.value.toLowerCase();
                  return (
                    <button key={c.value} role="radio" aria-checked={on} aria-label={c.label} title={c.label}
                      onClick={() => !on && onPatch({ color: c.value })}
                      className={cn("h-6 w-6 rounded-full border-2", on ? "border-ink ring-2 ring-offset-1 ring-ink/30" : "border-white shadow")}
                      style={{ backgroundColor: c.value }} />
                  );
                })}
              </div>
            </div>
          )}
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
            <span className="text-sm text-ink-soft">Rotate <span className="tabular-nums text-ink-faint">({Math.round(item.rotation)}°)</span></span>
            <button className="btn-secondary py-1 px-2 text-xs" onClick={() => onPatch({ rotation: (item.rotation - 15) % 360 })}>⟲ 15°</button>
            <button className="btn-secondary py-1 px-2 text-xs" onClick={() => onPatch({ rotation: (item.rotation + 15) % 360 })}>⟳ 15°</button>
            {item.rotation !== 0 && <button className="btn-ghost py-1 px-2 text-xs" onClick={() => onPatch({ rotation: 0 })}>Reset</button>}
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary py-1.5 text-sm" onClick={onDuplicate}>Duplicate</button>
            <button className="btn-ghost py-1.5 text-sm text-clay-600 hover:text-clay-600" onClick={onDelete}>Delete</button>
          </div>
          <p className="text-[11px] text-ink-faint">
            {isTable
              ? "Tip: drag to move; change its size and seats above; arrow keys nudge."
              : <>Tip: drag to move; drag the handles to {line ? "change length and angle" : "resize or rotate"} (Shift for {line ? "any angle" : "same proportions"}); arrow keys nudge.</>}
          </p>
        </div>
      )}
    </div>
  );
}
