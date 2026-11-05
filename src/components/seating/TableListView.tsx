"use client";

import { cn, fullName } from "@/lib/utils";
import { guestWarning, WARNING_TEXT, type SeatingGuest, type SeatingItem } from "@/lib/seating";
import type { TableLook } from "./FloorPlan";

/** Tables as cards — the phone (and keyboard-friendly) way to seat people: select guests in the
 * guest list, then "Seat here". Same data and rules as the floor view. */
export function TableListView({ tables, look, seatedAt, usage, selectedCount, onSeatHere, onOpen }: {
  tables: SeatingItem[];
  look: (t: SeatingItem) => TableLook;
  seatedAt: (tableId: string) => SeatingGuest[];
  usage: Record<string, { seats: number; guests: number }>;
  selectedCount: number;
  onSeatHere: (tableId: string) => void;
  onOpen: (tableId: string) => void;
}) {
  if (tables.length === 0) return <p className="card p-4 text-sm text-ink-faint">No tables yet.</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {tables.map((t) => {
        const l = look(t);
        const u = usage[t.id] || { seats: 0, guests: 0 };
        const seated = seatedAt(t.id);
        const over = t.capacity !== null && u.seats > t.capacity;
        return (
          <div key={t.id} className={cn("card p-3", !l.enabled && "opacity-60")} style={l.color ? { borderLeft: `4px solid ${l.color}` } : undefined}>
            <div className="flex items-baseline justify-between gap-2">
              <button className="font-medium text-ink hover:underline text-left" onClick={() => onOpen(t.id)}>{t.label}</button>
              <span className={cn("text-xs tabular-nums", over ? "text-clay-600 font-semibold" : "text-ink-faint")}>{u.seats}/{t.capacity ?? "∞"}</span>
            </div>
            <ul className="mt-1.5 text-sm text-ink-soft space-y-0.5">
              {seated.map((g) => {
                const w = guestWarning(g, t);
                return <li key={g.id} className="truncate">{fullName(g.first_name, g.last_name)}{w && <span title={WARNING_TEXT[w]} className="ml-1 text-clay-600">!</span>}</li>;
              })}
              {u.guests > seated.length && <li className="text-xs text-ink-faint">+{u.guests - seated.length} from other clones</li>}
              {l.pending > 0 && <li className="text-xs text-brass-600">⏳ {l.pending} awaiting approval</li>}
            </ul>
            {selectedCount > 0 && l.enabled && (
              <button className="mt-2 btn-secondary w-full py-1.5 text-sm" onClick={() => onSeatHere(t.id)}>Seat {selectedCount} here</button>
            )}
          </div>
        );
      })}
    </div>
  );
}
