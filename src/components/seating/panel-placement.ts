// Pure: where the floating inspector may sit over the floor plan. The one rule: it never covers the
// selected item (including its chairs, a door's swing arc and its handles).

export interface Rect { left: number; top: number; right: number; bottom: number; }
export interface Spot { left: number; top: number; }

const PAD = 8;     // from the floor area's edges
const GAP = 12;    // between the panel and the item

const overlaps = (a: Rect, b: Rect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** A spot for a `pw`×`ph` panel inside a `W`×`H` area that doesn't overlap `item` (null = item not
 * visible, so anywhere is fine). Tries `preferred` (where the planner last put it) first, then the
 * four corners, then right beside the item. With `nearTo`, picks the clear spot closest to that
 * point instead (after the planner drops the panel on the item). Returns null when nothing fits —
 * the caller then docks the panel outside the floor. */
export function choosePanelSpot(o: { W: number; H: number; pw: number; ph: number; item: Rect | null; preferred?: Spot | null; nearTo?: Spot }): Spot | null {
  const { W, H, pw, ph, item } = o;
  if (pw > W - PAD * 2 || ph > H - PAD * 2) return null;
  const clampTop = (t: number) => Math.min(Math.max(PAD, t), H - ph - PAD);
  const clampLeft = (l: number) => Math.min(Math.max(PAD, l), W - pw - PAD);
  const candidates: Spot[] = [
    ...(o.preferred ? [o.preferred] : []),
    { left: W - pw - PAD, top: PAD },
    { left: PAD, top: PAD },
    { left: W - pw - PAD, top: H - ph - PAD },
    { left: PAD, top: H - ph - PAD },
  ];
  if (item) {
    candidates.push(
      { left: item.right + GAP, top: clampTop(item.top) },
      { left: item.left - GAP - pw, top: clampTop(item.top) },
      { left: clampLeft(item.left), top: item.bottom + GAP },
      { left: clampLeft(item.left), top: item.top - GAP - ph },
    );
  }
  const fits = (c: Spot) =>
    c.left >= PAD - 0.5 && c.top >= PAD - 0.5 && c.left + pw <= W - PAD + 0.5 && c.top + ph <= H - PAD + 0.5 &&
    (!item || !overlaps({ left: c.left, top: c.top, right: c.left + pw, bottom: c.top + ph }, item));
  const ok = candidates.filter(fits);
  if (ok.length === 0) return null;
  if (o.nearTo) {
    const d = (c: Spot) => Math.hypot(c.left - o.nearTo!.left, c.top - o.nearTo!.top);
    return ok.sort((a, b) => d(a) - d(b))[0];
  }
  return ok[0];
}
