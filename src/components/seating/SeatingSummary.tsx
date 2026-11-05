"use client";

import { cn, formatNumber } from "@/lib/utils";
import { tablesNeeded } from "@/lib/seating";

export interface SummaryNumbers {
  attendingSeats: number;  // chairs attending guests need
  seatedSeats: number;     // of those, already at a table
  capacity: number;        // chairs at the tables in scope
  tables: number;
  typicalSize: number;     // most common table size, for the "need N more tables" hint
  warnings: number;
}

/** Headcount calculator: how many chairs attending guests need vs. how many the floor has. */
export function SeatingSummary({ n, onGenerate }: { n: SummaryNumbers; onGenerate?: (suggested: number) => void }) {
  const short = n.attendingSeats - n.capacity;
  const more = tablesNeeded(short, n.typicalSize);
  const tiles = [
    { label: "Attending", value: n.attendingSeats, hint: "seats needed" },
    { label: "Seated", value: n.seatedSeats, hint: `${formatNumber(Math.max(0, n.attendingSeats - n.seatedSeats))} still to place` },
    { label: "Seats", value: n.capacity, hint: `${n.tables} table${n.tables === 1 ? "" : "s"}` },
  ];
  return (
    <div className="card p-4">
      <div className="grid grid-cols-3 gap-3">
        {tiles.map((t) => (
          <div key={t.label}>
            <p className="text-xs uppercase tracking-wide text-ink-faint">{t.label}</p>
            <p className="font-serif text-2xl text-ink tabular-nums">{formatNumber(t.value)}</p>
            <p className="text-xs text-ink-faint">{t.hint}</p>
          </div>
        ))}
      </div>
      <p className={cn("mt-3 text-sm", short > 0 ? "text-clay-600" : "text-moss-600")}>
        {short > 0 ? (
          <>
            {formatNumber(short)} seat{short === 1 ? "" : "s"} short — about {more} more table{more === 1 ? "" : "s"} of {n.typicalSize}.
            {onGenerate && <button className="ml-2 font-medium text-wine-500 hover:underline" onClick={() => onGenerate(more)}>Add them</button>}
          </>
        ) : n.attendingSeats === 0 ? (
          <span className="text-ink-faint">No attending guests yet.</span>
        ) : (
          <>Enough seats for everyone attending{short < 0 ? ` (${formatNumber(-short)} spare)` : ""}.</>
        )}
      </p>
      {n.warnings > 0 && <p className="mt-1 text-sm text-clay-600">{n.warnings} seated guest{n.warnings === 1 ? " needs" : "s need"} a second look (marked ! on the floor).</p>}
    </div>
  );
}
