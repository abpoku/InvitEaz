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
  // Structures — usually drawn on the floor with the Draw tools rather than added at a default size.
  wall: { label: "Wall", width: 200, height: 12 },
  door: { label: "Door", width: 90, height: 12 },
  window: { label: "Window", width: 120, height: 10 },
  pillar: { label: "Pillar", width: 40, height: 40 },
  stairs: { label: "Stairs", width: 100, height: 160 },
  area: { label: "Area", width: 300, height: 200 },
};

/** Drawn point-to-point: width is the length along the drag, height a fixed thickness, rotation the
 * drag's angle. Everything else is drawn as a box. */
export const LINE_SHAPES = new Set(["wall", "door", "window"]);
export const STRUCTURE_TOOLS = ["wall", "door", "window", "pillar", "stairs", "area"] as const;
/** Structures whose name isn't drawn on the floor (they're too thin, or the symbol says it all). */
export const UNLABELED_SHAPES = new Set(["wall", "door", "window", "pillar"]);

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
export function floorSize(items: (Pick<SeatingItem, "x" | "y" | "width" | "height"> & { rotation?: number })[]) {
  let w = FLOOR_MIN.width, h = FLOOR_MIN.height;
  for (const i of items) {
    const b = itemBounds({ rotation: 0, ...i });
    w = Math.max(w, b.right + 200);
    h = Math.max(h, b.bottom + 200);
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

export interface Box { x: number; y: number; width: number; height: number; rotation: number; }

/** The item for a drag from (x0,y0) to (x1,y1) with a Draw tool. A line structure runs along the
 * drag (angle snapped to 15°, so walls come out straight); a box structure fills the dragged
 * rectangle. A click (or a tiny drag) drops the default size there instead. */
export function structureFromDrag(shape: string, x0: number, y0: number, x1: number, y1: number): Box {
  const def = FIXTURE_SHAPES[shape];
  if (LINE_SHAPES.has(shape)) {
    const dx = x1 - x0, dy = y1 - y0;
    let length = Math.hypot(dx, dy);
    let angle = 0;
    if (length < GRID * 2) length = def.width;
    else angle = Math.round((Math.atan2(dy, dx) * 180) / Math.PI / 15) * 15;
    const rad = (angle * Math.PI) / 180;
    length = snap(length) || GRID;
    // Rotation is about the centre, so place the centre halfway along the line.
    const cx = x0 + (Math.cos(rad) * length) / 2, cy = y0 + (Math.sin(rad) * length) / 2;
    return { x: Math.max(0, Math.round(cx - length / 2)), y: Math.max(0, Math.round(cy - def.height / 2)), width: length, height: def.height, rotation: angle };
  }
  const left = snap(Math.min(x0, x1)), top = snap(Math.min(y0, y1));
  const w = snap(Math.abs(x1 - x0)), h = snap(Math.abs(y1 - y0));
  if (w < GRID * 2 || h < GRID * 2) return { x: Math.max(0, snap(x0)), y: Math.max(0, snap(y0)), width: def.width, height: def.height, rotation: 0 };
  return { x: Math.max(0, left), y: Math.max(0, top), width: w, height: h, rotation: 0 };
}

/** Axis-aligned bounds of an item after its rotation (about its centre). */
export function itemBounds(i: Box) {
  const rad = (i.rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad));
  const w = i.width * c + i.height * s, h = i.width * s + i.height * c;
  const cx = i.x + i.width / 2, cy = i.y + i.height / 2;
  return { left: cx - w / 2, top: cy - h / 2, right: cx + w / 2, bottom: cy + h / 2 };
}

/** Ids of the items touching a selection rectangle (rotated items by their bounds). */
export function itemsInRect<T extends Box & { id: string }>(items: T[], r: { left: number; top: number; right: number; bottom: number }): string[] {
  return items.filter((i) => {
    const b = itemBounds(i);
    return b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top;
  }).map((i) => i.id);
}

/** A group move by (dx, dy), snapped to the grid and limited so nothing leaves the floor's top/left
 * edge. Moving by a delta (not snapping each item) keeps the group's exact arrangement. */
export function clampGroupDelta(items: Pick<Box, "x" | "y">[], dx: number, dy: number) {
  const minX = Math.min(...items.map((i) => i.x)), minY = Math.min(...items.map((i) => i.y));
  return { dx: Math.max(-minX, snap(dx)), dy: Math.max(-minY, snap(dy)) };
}

/** Paint order: areas underneath, then structures and other room items, tables on top. */
export function itemLayer(i: Pick<SeatingItem, "kind" | "shape">): number {
  return i.kind === "table" ? 2 : i.shape === "area" ? 0 : 1;
}
