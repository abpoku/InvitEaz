// Pure, client-safe: seating chart shapes, seat math and layout helpers. The DB side is
// models/seating.ts; the UI is components/seating/.

export type SeatingKind = "table" | "fixture";
export type RsvpStatus = "attending" | "declined" | "maybe";

export interface ShapeDef { label: string; width: number; height: number; seats?: number; }

export const TABLE_SHAPES: Record<string, ShapeDef> = {
  round: { label: "Round", width: 120, height: 120, seats: 8 },
  square: { label: "Square", width: 100, height: 100, seats: 4 },
  rect: { label: "Rectangle", width: 170, height: 90, seats: 6 },
  banquet: { label: "Long banquet", width: 280, height: 70, seats: 10 },
  head: { label: "Head table", width: 320, height: 60, seats: 6 },
};

export const FIXTURE_SHAPES: Record<string, ShapeDef> = {
  stage: { label: "Stage", width: 320, height: 140 },
  dance_floor: { label: "Dance floor", width: 240, height: 240 },
  bar: { label: "Bar", width: 200, height: 60 },
  buffet: { label: "Buffet", width: 240, height: 60 },
  dj: { label: "DJ booth", width: 120, height: 80 },
  entrance: { label: "Entrance", width: 140, height: 30 },
  restrooms: { label: "Restrooms", width: 130, height: 80 },
  label: { label: "Label", width: 160, height: 40 },
};

export function shapeDef(kind: SeatingKind, shape: string): ShapeDef | undefined {
  return (kind === "table" ? TABLE_SHAPES : FIXTURE_SHAPES)[shape];
}

export interface SeatingItem {
  id: string;
  kind: SeatingKind;
  shape: string;
  label: string;
  capacity: number | null;
  assembly_id: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface SeatingGuest {
  id: string;
  first_name: string;
  last_name: string;
  assembly_id: string | null;
  group_id: string | null;
  group_name: string | null;
  rsvp_status: RsvpStatus | null;
  num_attending: number | null;
  table_id: string | null;
}

/** Chairs a guest takes. A party recorded on one invitation ("attending, 3 people" — the older
 * individual-link path) takes all of them; group-link households are already one row per person.
 * Anyone not (yet) attending holds one chair while seated — they're flagged, never auto-removed. */
export function seatsFor(g: { rsvp_status: string | null; num_attending: number | null }): number {
  return g.rsvp_status === "attending" ? Math.max(1, Number(g.num_attending) || 1) : 1;
}

export type GuestWarning = "declined" | "maybe" | "no_response" | "other_clone";

/** Why a seated guest needs a second look, or null. `table` is where they're seated. */
export function guestWarning(g: SeatingGuest, table: SeatingItem | undefined): GuestWarning | null {
  if (g.rsvp_status === "declined") return "declined";
  if (g.rsvp_status === "maybe") return "maybe";
  if (g.rsvp_status !== "attending") return "no_response";
  if (table?.assembly_id && g.assembly_id !== table.assembly_id) return "other_clone";
  return null;
}

export const WARNING_TEXT: Record<GuestWarning, string> = {
  declined: "Declined — no longer attending",
  maybe: "Marked Maybe",
  no_response: "Hasn't responded",
  other_clone: "Not in the clone this table is set aside for",
};

export const FLOOR_MIN = { width: 1400, height: 900 };
const MARGIN = 40;
const GAP = 50;
export const GRID = 10;

export const snap = (n: number) => Math.round(n / GRID) * GRID;

/** Floor canvas size: the default, grown to fit whatever has been placed beyond it. */
export function floorSize(items: Pick<SeatingItem, "x" | "y" | "width" | "height">[]) {
  let w = FLOOR_MIN.width, h = FLOOR_MIN.height;
  for (const i of items) {
    w = Math.max(w, i.x + i.width + 200);
    h = Math.max(h, i.y + i.height + 200);
  }
  return { width: w, height: h };
}

/** Top-left positions for `count` new items of one size, in rows below everything already placed. */
export function placeBelow(existing: Pick<SeatingItem, "y" | "height">[], count: number, width: number, height: number, floorWidth = FLOOR_MIN.width) {
  const top = existing.length ? Math.max(...existing.map((i) => i.y + i.height)) + GAP : MARGIN;
  const perRow = Math.max(1, Math.floor((floorWidth - MARGIN * 2 + GAP) / (width + GAP)));
  return Array.from({ length: count }, (_, n) => ({
    x: snap(MARGIN + (n % perRow) * (width + GAP)),
    y: snap(top + Math.floor(n / perRow) * (height + GAP)),
  }));
}

/** Next free table number, so generated tables continue "Table 7, Table 8…" after existing ones. */
export function nextTableNumber(items: Pick<SeatingItem, "kind" | "label">[]): number {
  let max = 0;
  for (const i of items) {
    if (i.kind !== "table") continue;
    const m = i.label.match(/(\d+)\s*$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** Stable color per clone (by its position in the clone list), for tables set aside for it. */
const CLONE_COLORS = ["#9C2B4E", "#3F7D58", "#AD8636", "#3A6EA5", "#7A4FA0", "#B4472F", "#2E8A8A", "#5C6B2E"];
export function cloneColor(index: number): string {
  return CLONE_COLORS[((index % CLONE_COLORS.length) + CLONE_COLORS.length) % CLONE_COLORS.length];
}

/** Tables needed to seat `seatsNeeded` more people at `perTable` each. */
export function tablesNeeded(seatsNeeded: number, perTable: number): number {
  return seatsNeeded <= 0 || perTable <= 0 ? 0 : Math.ceil(seatsNeeded / perTable);
}
