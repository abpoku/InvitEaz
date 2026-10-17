"use client";

import type { SortDir, SortState } from "@/lib/table-sort";

// Shared pieces of the phone layout (below md) that replaces the wide tables on Invitees, Responses
// and Tickets with card lists. Each tab keeps its desktop table as-is and renders both off the same
// rows, selection, sort and handlers.

/** Phones only: a selection's bulk-action bar docks to the bottom of the screen (reachable from
 * anywhere in a long list) instead of sitting above it. The page adds bottom padding (`max-md:pb-44`)
 * while it shows, so the bar never covers the last card. */
export const MOBILE_DOCK =
  "max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-30 max-md:mt-0 max-md:rounded-none max-md:border-x-0 max-md:border-b-0 max-md:shadow-lifted max-md:pb-[calc(0.625rem+env(safe-area-inset-bottom))]";

/** The phone layout has no column headings to tap, so sorting is a dropdown driving the same
 * useTableSort state (and remembered sort) as the desktop table's headings. */
export function SortSelect({ sort, onSort, options }: {
  sort: SortState;
  onSort: (key: string, firstDir: SortDir) => void;
  options: { key: string; dir: SortDir; label: string }[];
}) {
  const value = `${sort.key}:${sort.dir}`;
  const known = options.some((o) => `${o.key}:${o.dir}` === value);
  return (
    <select
      aria-label="Sort by"
      className="input w-auto py-1.5 text-base"
      value={known ? value : ""}
      onChange={(e) => {
        const o = options.find((x) => `${x.key}:${x.dir}` === e.target.value);
        // onSort flips the direction of the current column and starts a new column at firstDir,
        // so one call lands on exactly the option picked.
        if (o && (o.key !== sort.key || o.dir !== sort.dir)) onSort(o.key, o.dir);
      }}
    >
      {!known && <option value="">Sorted by a column</option>}
      {options.map((o) => <option key={`${o.key}:${o.dir}`} value={`${o.key}:${o.dir}`}>{o.label}</option>)}
    </select>
  );
}

/** The card list's header row: "Select all" (when the viewer can select) and the sort dropdown. */
export function MobileListHeader({ selectAll, sort }: {
  selectAll?: { checked: boolean; onChange: () => void };
  sort: React.ReactNode;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 pr-3 border-b border-paper-line ${selectAll ? "pl-1" : "pl-4 py-1.5"}`}>
      {selectAll ? (
        <label className="flex items-center text-sm text-ink-soft">
          <span className="flex h-11 w-11 items-center justify-center">
            <input type="checkbox" className="h-5 w-5" checked={selectAll.checked} onChange={selectAll.onChange} />
          </span>
          Select all
        </label>
      ) : <span className="text-sm text-ink-faint">Sort</span>}
      {sort}
    </div>
  );
}

/** A card's selection checkbox, as a full 44px tap target. */
export function CardCheckbox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex h-11 w-11 shrink-0 items-center justify-center">
      <input type="checkbox" className="h-5 w-5" checked={checked} onChange={onChange} aria-label={label} />
    </label>
  );
}
