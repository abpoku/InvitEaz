// Pure, client-safe: column sorting shared by the Invitees, Responses and Tickets tables (see
// SortableHeader for the clickable headers and the remembered per-tab choice).

export type SortDir = "asc" | "desc";
export interface SortState { key: string; dir: SortDir }
export type SortValue = string | number | null | undefined;

// Natural order ("Table 2" before "Table 10") and case-insensitive, so names and answers sort the way
// a planner reads them.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** One column's comparison. Empty values (null, undefined, "") always go last, in either direction —
 * flipping to Z–A shouldn't bury everyone who has a value under the people who don't. */
export function compareValues(a: SortValue, b: SortValue, dir: SortDir): number {
  const emptyA = a === null || a === undefined || a === "";
  const emptyB = b === null || b === undefined || b === "";
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
  const c = typeof a === "number" && typeof b === "number" ? a - b : collator.compare(String(a), String(b));
  return dir === "asc" ? c : -c;
}

/** A sorted copy of `rows` by `value`, ties broken by `name` A–Z so the order is always stable. */
export function sortRows<T>(rows: T[], value: (row: T) => SortValue, dir: SortDir, name: (row: T) => string): T[] {
  return [...rows].sort((a, b) => compareValues(value(a), value(b), dir) || collator.compare(name(a), name(b)));
}

/** RSVP status in reading order: Attending, Maybe, Declined, then no response. */
export function statusRank(status: string | null | undefined): number {
  if (status === "attending") return 0;
  if (status === "maybe") return 1;
  if (status === "declined") return 2;
  return 3;
}

/** A free-text value as a number when it is one (so "10" sorts after "9"), else the trimmed text. */
export function numericOrText(value: string | null | undefined): SortValue {
  const s = (value ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : s;
}
