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
  double_door: { label: "Double door", width: 160, height: 12 },
  window: { label: "Window", width: 120, height: 10 },
  pillar: { label: "Pillar", width: 40, height: 40 },
  stairs: { label: "Stairs", width: 100, height: 160 },
  area: { label: "Area", width: 300, height: 200 },
  // Annotations: text, shapes, lines and arrows (colorable).
  text: { label: "Text", width: 220, height: 40 },
  shape_rect: { label: "Rectangle", width: 160, height: 100 },
  shape_rounded: { label: "Rounded rectangle", width: 160, height: 100 },
  shape_ellipse: { label: "Ellipse", width: 140, height: 100 },
  shape_circle: { label: "Circle", width: 100, height: 100 },
  shape_triangle: { label: "Triangle", width: 120, height: 100 },
  shape_diamond: { label: "Diamond", width: 120, height: 120 },
  shape_hexagon: { label: "Hexagon", width: 130, height: 110 },
  shape_star: { label: "Star", width: 120, height: 120 },
  line: { label: "Line", width: 200, height: 16 },
  arrow: { label: "Arrow", width: 200, height: 22 },
  double_arrow: { label: "Double arrow", width: 200, height: 22 },
};

/** Drawn point-to-point: width is the length along the drag, height a fixed thickness, rotation the
 * drag's angle. Everything else is drawn as a box. */
export const LINE_SHAPES = new Set(["wall", "door", "double_door", "window", "line", "arrow", "double_arrow"]);
export const STRUCTURE_TOOLS = ["wall", "door", "double_door", "window", "pillar", "stairs", "area"] as const;
/** The Shapes dropdown, in two sections. */
export const SHAPE_TOOLS = ["shape_rect", "shape_rounded", "shape_ellipse", "shape_circle", "shape_triangle", "shape_diamond", "shape_hexagon", "shape_star"] as const;
export const LINE_TOOLS = ["line", "arrow", "double_arrow"] as const;
/** Items whose color the planner can pick. */
export const COLORED_SHAPES = new Set<string>(["text", ...SHAPE_TOOLS, ...LINE_TOOLS]);
/** Shapes that keep equal width and height when resized. */
export const SQUARE_SHAPES = new Set(["round", "shape_circle"]);
/** Structures whose name isn't drawn on the floor (they're too thin, or the symbol says it all). */
export const UNLABELED_SHAPES = new Set(["wall", "door", "double_door", "window", "pillar", ...LINE_TOOLS]);

export const ITEM_COLORS = [
  { value: "#1E2233", label: "Ink" }, { value: "#9C2B4E", label: "Wine" }, { value: "#3F7D58", label: "Green" },
  { value: "#AD8636", label: "Gold" }, { value: "#3A6EA5", label: "Blue" }, { value: "#B4472F", label: "Red" },
  { value: "#7A4FA0", label: "Purple" }, { value: "#83879A", label: "Gray" },
];
export const DEFAULT_ITEM_COLOR = "#1E2233";

/** Shapes a fixture can be switched to in the inspector: same family, so a drawn line never turns
 * into a box (or back) and loses its geometry. */
export function shapeFamily(shape: string): string[] {
  const lines = Object.keys(FIXTURE_SHAPES).filter((k) => LINE_SHAPES.has(k));
  if (LINE_SHAPES.has(shape)) return lines;
  return Object.keys(FIXTURE_SHAPES).filter((k) => !LINE_SHAPES.has(k));
}

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
  color: string | null;
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

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;
/** Angles in (-180, 180]. */
const normAngle = (deg: number) => { const a = ((deg % 360) + 360) % 360; return a > 180 ? a - 360 : a; };
const round1 = (n: number) => Math.round(n * 10) / 10;

/** The box for a line-like item from end A to end B (rotation about the centre lands it on A→B). */
function lineBox(ax: number, ay: number, bx: number, by: number, thickness: number): Box {
  const length = Math.max(GRID, Math.hypot(bx - ax, by - ay));
  const angle = normAngle(toDeg(Math.atan2(by - ay, bx - ax)));
  const cx = (ax + bx) / 2, cy = (ay + by) / 2;
  // x/y are the unrotated box's corner, which can be negative for a steep line near the floor's
  // edge even though the line itself is on the floor — don't clamp them.
  return { x: round1(cx - length / 2), y: round1(cy - thickness / 2), width: round1(length), height: thickness, rotation: angle };
}

/** World positions of a line-like item's two ends. */
export function lineEnds(i: Box) {
  const cx = i.x + i.width / 2, cy = i.y + i.height / 2, r = toRad(i.rotation), h = i.width / 2;
  return { a: { x: cx - Math.cos(r) * h, y: cy - Math.sin(r) * h }, b: { x: cx + Math.cos(r) * h, y: cy + Math.sin(r) * h } };
}

/** A line from fixed point F to the pointer P: angle snapped to 15° and length to the grid unless
 * `free` (Shift held). `fixedIsStart` keeps the item's direction when its first end is dragged. */
export function lineFromPointer(f: { x: number; y: number }, p: { x: number; y: number }, thickness: number, fixedIsStart: boolean, free = false): Box {
  let angle = Math.atan2(p.y - f.y, p.x - f.x);
  let length = Math.hypot(p.x - f.x, p.y - f.y);
  if (!free) { angle = toRad(Math.round(toDeg(angle) / 15) * 15); length = snap(length); }
  length = Math.max(GRID, length);
  const q = { x: f.x + Math.cos(angle) * length, y: f.y + Math.sin(angle) * length };
  return fixedIsStart ? lineBox(f.x, f.y, q.x, q.y, thickness) : lineBox(q.x, q.y, f.x, f.y, thickness);
}

/** The item for a drag from (x0,y0) to (x1,y1) with a Draw tool. A line item runs along the drag
 * (angle snapped to 15°, so walls come out straight); a box item fills the dragged rectangle. A
 * click (or a tiny drag) drops the default size there instead. */
export function structureFromDrag(shape: string, x0: number, y0: number, x1: number, y1: number): Box {
  const def = FIXTURE_SHAPES[shape];
  if (LINE_SHAPES.has(shape)) {
    if (Math.hypot(x1 - x0, y1 - y0) < GRID * 2) return lineBox(x0, y0, x0 + def.width, y0, def.height);
    return lineFromPointer({ x: x0, y: y0 }, { x: x1, y: y1 }, def.height, true);
  }
  let w = snap(Math.abs(x1 - x0)), h = snap(Math.abs(y1 - y0));
  if (w < GRID * 2 || h < GRID * 2) return { x: Math.max(0, snap(x0)), y: Math.max(0, snap(y0)), width: def.width, height: def.height, rotation: 0 };
  if (SQUARE_SHAPES.has(shape)) w = h = Math.max(w, h);
  const left = x1 < x0 ? x0 - w : x0, top = y1 < y0 ? y0 - h : y0;
  return { x: Math.max(0, snap(left)), y: Math.max(0, snap(top)), width: w, height: h, rotation: 0 };
}

export type Handle = { hx: -1 | 0 | 1; hy: -1 | 0 | 1 };
export const RESIZE_HANDLES: Handle[] = [
  { hx: -1, hy: -1 }, { hx: 0, hy: -1 }, { hx: 1, hy: -1 }, { hx: 1, hy: 0 },
  { hx: 1, hy: 1 }, { hx: 0, hy: 1 }, { hx: -1, hy: 1 }, { hx: -1, hy: 0 },
];
const MIN_SIZE = GRID;

/** Resize a (possibly rotated) box by dragging one handle to world point P: the opposite edge/corner
 * stays put. `keepRatio` (Shift on a corner, or a round table/circle) keeps the proportions. */
export function resizeBox(i: Box, h: Handle, p: { x: number; y: number }, keepRatio: boolean): Box {
  const r = toRad(i.rotation), cos = Math.cos(r), sin = Math.sin(r);
  const cx = i.x + i.width / 2, cy = i.y + i.height / 2;
  // Pointer in the item's own (unrotated) frame, origin at its centre.
  const lx = (p.x - cx) * cos + (p.y - cy) * sin, ly = -(p.x - cx) * sin + (p.y - cy) * cos;
  const ax = (-h.hx * i.width) / 2, ay = (-h.hy * i.height) / 2; // the anchor that stays put
  let w = h.hx ? Math.max(MIN_SIZE, snap(h.hx * (lx - ax))) : i.width;
  let ht = h.hy ? Math.max(MIN_SIZE, snap(h.hy * (ly - ay))) : i.height;
  if (keepRatio) {
    const ratio = i.width / i.height;
    if (h.hx && h.hy) { if (w / ratio > ht) ht = w / ratio; else w = ht * ratio; }
    else if (h.hx) ht = w / ratio;
    else w = ht * ratio;
    w = Math.max(MIN_SIZE, Math.round(w)); ht = Math.max(MIN_SIZE, Math.round(ht));
  }
  // New centre in the local frame, then back to world coordinates.
  const ncx = h.hx ? ax + (h.hx * w) / 2 : 0, ncy = h.hy ? ay + (h.hy * ht) / 2 : 0;
  const wx = cx + ncx * cos - ncy * sin, wy = cy + ncx * sin + ncy * cos;
  return { x: round1(wx - w / 2), y: round1(wy - ht / 2), width: w, height: ht, rotation: i.rotation };
}

/** Rotation from the rotate handle (above the item's top edge) following world point P; 15° steps
 * unless `free`. */
export function rotateToward(i: Box, p: { x: number; y: number }, free: boolean): number {
  const cx = i.x + i.width / 2, cy = i.y + i.height / 2;
  const deg = toDeg(Math.atan2(p.y - cy, p.x - cx)) + 90;
  return normAngle(free ? Math.round(deg) : Math.round(deg / 15) * 15);
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

/** A group move by (dx, dy), snapped to the grid and limited so nothing (by its rotated bounds) leaves
 * the floor's top/left edge. Moving by a delta (not snapping each item) keeps the group's exact
 * arrangement. */
export function clampGroupDelta(items: Box[], dx: number, dy: number) {
  const minX = Math.min(...items.map((i) => itemBounds(i).left)), minY = Math.min(...items.map((i) => itemBounds(i).top));
  return { dx: Math.max(Math.min(0, -minX), snap(dx)), dy: Math.max(Math.min(0, -minY), snap(dy)) };
}

/** Paint order: areas underneath, then decorative shapes, then walls/doors/room items, then tables,
 * and text, lines and arrows on top so a note or an arrow pointing at a table is never hidden. */
export function itemLayer(i: Pick<SeatingItem, "kind" | "shape">): number {
  if (i.kind === "table") return 3;
  if (i.shape === "area") return 0;
  if (i.shape.startsWith("shape_")) return 1;
  if (i.shape === "text" || (LINE_TOOLS as readonly string[]).includes(i.shape)) return 4;
  return 2;
}
