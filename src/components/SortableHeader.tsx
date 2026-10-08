"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SortDir, SortState } from "@/lib/table-sort";

/** The table's current sort, remembered per table in this browser (localStorage). `columns` are the
 * keys sortable right now — a remembered key that no longer exists here (e.g. a custom field from
 * another event) falls back to `initial`. Clicking a new column starts at that column's `firstDir`;
 * clicking it again flips the direction. */
export function useTableSort(storageKey: string, initial: SortState, columns: string[]) {
  const [sort, setSort] = useState<SortState>(initial);

  // Read after mount, not during render, so the server-rendered markup and the first client render match.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (saved && typeof saved.key === "string" && (saved.dir === "asc" || saved.dir === "desc")) setSort(saved);
    } catch {}
  }, [storageKey]);

  // Memoised so the result is the same object until something actually changes — callers put it in
  // useMemo/useEffect dependencies, and a fresh fallback object every render would recompute them each time.
  const columnList = columns.join("\u0000");
  const active = useMemo<SortState>(
    () => (columnList.split("\u0000").includes(sort.key) ? sort : { key: initial.key, dir: initial.dir }),
    [sort, columnList, initial.key, initial.dir]
  );

  // Compared against what's on screen (`active`), not the raw stored value, so clicking the column
  // that's shown as sorted always flips it — even when a stale remembered key was ignored.
  const onSort = useCallback((key: string, firstDir: SortDir) => {
    const next: SortState = active.key === key ? { key, dir: active.dir === "asc" ? "desc" : "asc" } : { key, dir: firstDir };
    setSort(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {}
  }, [active, storageKey]);

  return [active, onSort] as const;
}

/** A sortable column heading: the label plus up/down arrows, the active direction drawn darker.
 * `firstDir` is what a first click gives — "asc" (A–Z) for text, "desc" (highest/newest first) for
 * money, counts and dates. */
export function SortTh({
  label, column, sort, onSort, firstDir = "asc", className = "px-5 py-3 font-medium whitespace-nowrap",
}: {
  label: React.ReactNode;
  column: string;
  sort: SortState;
  onSort: (key: string, firstDir: SortDir) => void;
  firstDir?: SortDir;
  className?: string;
}) {
  const active = sort.key === column;
  const dir = active ? sort.dir : null;
  return (
    <th className={className} aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}>
      <button
        type="button"
        onClick={() => onSort(column, firstDir)}
        className={`group inline-flex items-center gap-1.5 font-medium hover:text-ink ${active ? "text-ink" : ""}`}
      >
        {label}
        <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden="true" className="shrink-0">
          <path d="M4 1 7 4.5H1Z" className={dir === "asc" ? "fill-ink" : "fill-ink-faint opacity-40 group-hover:opacity-70"} />
          <path d="M4 11 1 7.5h6Z" className={dir === "desc" ? "fill-ink" : "fill-ink-faint opacity-40 group-hover:opacity-70"} />
        </svg>
      </button>
    </th>
  );
}
