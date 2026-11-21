"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { cn, fullName } from "@/lib/utils";
import {
  FIXTURE_SHAPES, LINE_SHAPES, STRUCTURE_TOOLS, TABLE_SHAPES, clampGroupDelta, cloneColor, guestWarning, nextTableNumber,
  matchesGuestSearch, placeBelow, seatsFor, seatingOrder, GRID, HIDDEN_SEAT_COLOR, NO_CLONE_SEAT_COLOR, SEAT_COLOR, type Box, type SeatingGuest, type SeatingItem, type SeatingKind,
} from "@/lib/seating";
import type { ExportDoc } from "@/lib/table-export";
import { Modal } from "@/components/Modal";
import { FloorPlan, type Chair, type TableLook } from "./FloorPlan";
import { GuestPanel } from "./GuestPanel";
import { TableInspector } from "./TableInspector";
import { RequestsPanel } from "./RequestsPanel";
import { SeatingSummary } from "./SeatingSummary";
import { GenerateTablesModal, type GenerateSpec } from "./GenerateTablesModal";
import { SeatingExportMenu } from "./SeatingExportMenu";
import { TableListView } from "./TableListView";
import { DrawToolbar, HistoryButtons } from "./DrawToolbar";
import { FloatingInspector } from "./FloatingInspector";
import type { SeatingData } from "./types";

type Msg = { kind: "error" | "info"; text: string } | null;

async function call(url: string, init?: RequestInit): Promise<{ ok: boolean; data: any }> {
  const res = await fetch(url, init?.body ? { ...init, headers: { "Content-Type": "application/json" } } : init);
  let data: any = {};
  try { data = await res.json(); } catch {}
  return { ok: res.ok, data };
}

const ZOOM_MIN = 0.25, ZOOM_MAX = 2;

const byLabel = (a: SeatingItem, b: SeatingItem) => a.label.localeCompare(b.label, undefined, { numeric: true });

export function SeatingManager({ eventId, eventName }: { eventId: string; eventName: string }) {
  const base = `/api/events/${eventId}/seating`;
  const [data, setData] = useState<SeatingData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [drawTool, setDrawTool] = useState<string | null>(null);
  const [gestureActive, setGestureActive] = useState(false);
  const [docked, setDocked] = useState(false);
  const floorWrap = useRef<HTMLDivElement>(null);
  const [selectedGuests, setSelectedGuests] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"floor" | "list">("floor");
  const [zoom, setZoom] = useState(1);
  const [showNames, setShowNames] = useState(false);
  useEffect(() => { try { setShowNames(localStorage.getItem("seating:showNames") === "1"); } catch {} }, []);
  function toggleNames() {
    setShowNames((v) => {
      try { localStorage.setItem("seating:showNames", v ? "0" : "1"); } catch {}
      return !v;
    });
  }
  const [generate, setGenerate] = useState<number | null>(null);
  const [wide, setWide] = useState(true);
  const floorRef = useRef<HTMLDivElement>(null);
  // Arrow-key nudges move items on screen at once and save together after a short pause.
  const nudged = useRef<Set<string>>(new Set());
  const nudgeTimer = useRef<ReturnType<typeof setTimeout>>();
  const selectOne = (id: string | null) => setSelectedIds(new Set(id ? [id] : []));
  useEffect(() => { if (selectedIds.size !== 1) setDocked(false); }, [selectedIds]);

  const load = useCallback(async () => {
    const { ok, data } = await call(base);
    if (!ok) { setLoadError(data.error || "We couldn't load seating. Try refreshing the page."); return; }
    setLoadError(null);
    setData(data);
    return data as SeatingData;
  }, [base]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // Phones start on the list of tables; the floor plan is still one tap away.
    if (window.innerWidth < 640) setView("list");
    const measure = () => setWide(window.innerWidth >= 1024);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  useEffect(() => {
    if (msg?.kind !== "info") return;
    const t = setTimeout(() => setMsg(null), 5000);
    return () => clearTimeout(t);
  }, [msg]);

  // ---------- derived ----------
  const d = data;
  const me = d?.me;
  const isScoped = !!me?.assemblyId;
  const items = useMemo(() => d?.items || [], [d]);
  const tables = useMemo(() => items.filter((i) => i.kind === "table"), [items]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const cloneById = useMemo(() => new Map((d?.clones || []).map((c) => [c.id, c])), [d]);
  const guestsAt = useMemo(() => {
    const m = new Map<string, SeatingGuest[]>();
    for (const g of d?.guests || []) if (g.table_id) m.set(g.table_id, [...(m.get(g.table_id) || []), g]);
    for (const [k, v] of m) m.set(k, seatingOrder(v));
    return m;
  }, [d]);
  const pendingTo = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of d?.requests || []) if (r.to_table_id) m.set(r.to_table_id, (m.get(r.to_table_id) || 0) + 1);
    return m;
  }, [d]);
  const pendingIds = useMemo(() => new Set((d?.requests || []).map((r) => r.invitee_id)), [d]);
  const tableLabel = useCallback((id: string | null) => (id ? itemById.get(id)?.label || "a removed table" : "no table"), [itemById]);

  // ---------- find a seated guest ----------
  const [find, setFind] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const found = useMemo(() => {
    if (!find.trim()) return null;
    const hits = (d?.guests || []).filter((g) => g.table_id && itemById.has(g.table_id) && matchesGuestSearch(g, find))
      .sort((a, b) => fullName(a.first_name, a.last_name).localeCompare(fullName(b.first_name, b.last_name)));
    return { hits, ids: new Set(hits.map((g) => g.id)), tables: new Set(hits.map((g) => g.table_id!)) };
  }, [d, find, itemById]);
  /** Scroll the floor so a table is in the middle, and open it. */
  function goToTable(id: string) {
    const t = itemById.get(id), box = floorBox.current;
    selectOne(id);
    if (!t || !box || view !== "floor") return;
    box.scrollTo({
      left: Math.max(0, (t.x + t.width / 2) * zoom - box.clientWidth / 2),
      top: Math.max(0, (t.y + t.height / 2) * zoom - box.clientHeight / 2),
      behavior: "smooth",
    });
  }

  /** A seated guest's chair color: their clone's color (the same one the legend and set-aside
   * tables use), or a neutral one when they're in no clone. */
  const seatColor = useCallback((g: SeatingGuest) => {
    if (!d?.clones.length && !g.assembly_id) return SEAT_COLOR;
    const c = g.assembly_id ? cloneById.get(g.assembly_id) : undefined;
    return c ? cloneColor(c.index) : g.assembly_id ? HIDDEN_SEAT_COLOR : NO_CLONE_SEAT_COLOR;
  }, [d, cloneById]);

  const look = useCallback((t: SeatingItem): TableLook => {
    const clone = t.assembly_id ? cloneById.get(t.assembly_id) : undefined;
    const here = guestsAt.get(t.id) || [];
    const usage = d?.usage[t.id] || { seats: 0, guests: 0 };
    const chairs: Chair[] = [];
    for (const g of here) {
      const color = seatColor(g), n = seatsFor(g), name = fullName(g.first_name, g.last_name);
      const match = !!found?.ids.has(g.id);
      for (let k = 0; k < n; k++) chairs.push({ color, label: k === 0 ? name : `${name} +${k}`, match: match && k === 0 });
    }
    // Other clones' guests (a clone planner sees only how many chairs they take).
    while (chairs.length < usage.seats) chairs.push({ color: HIDDEN_SEAT_COLOR, label: null });
    return {
      used: usage.seats,
      chairs,
      guests: here.map((g) => ({ id: g.id, name: fullName(g.first_name, g.last_name), color: seatColor(g), extra: seatsFor(g) - 1, warning: !!guestWarning(g, t) })),
      hiddenGuests: Math.max(0, usage.guests - here.length),
      pending: pendingTo.get(t.id) || 0,
      color: t.assembly_id ? (clone ? cloneColor(clone.index) : "#83879A") : null,
      enabled: !!me?.canSeat && (!me.assemblyId || t.assembly_id === me.assemblyId),
      warnings: here.filter((g) => guestWarning(g, t)).length,
    };
  }, [d, me, cloneById, pendingTo, guestsAt, seatColor, found]);

  const summary = useMemo(() => {
    const guests = d?.guests || [];
    const inScope = isScoped ? tables.filter((t) => t.assembly_id === me!.assemblyId) : tables;
    const attending = guests.filter((g) => g.rsvp_status === "attending");
    const sizes = new Map<number, number>();
    for (const t of inScope) if (t.capacity) sizes.set(t.capacity, (sizes.get(t.capacity) || 0) + 1);
    const typical = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 8;
    return {
      attendingSeats: attending.reduce((n, g) => n + seatsFor(g), 0),
      seatedSeats: attending.filter((g) => g.table_id).reduce((n, g) => n + seatsFor(g), 0),
      capacity: inScope.reduce((n, t) => n + (t.capacity || 0), 0),
      tables: inScope.length,
      typicalSize: typical,
      warnings: guests.filter((g) => g.table_id && guestWarning(g, itemById.get(g.table_id))).length,
    };
  }, [d, tables, isScoped, me, itemById]);

  // ---------- actions ----------
  async function seat(ids: string[], tableId: string | null) {
    if (!me?.canSeat || ids.length === 0) return;
    setMsg(null);
    const was = tablesOf(d?.guests || [], ids);
    const { ok, data: r } = await call(`${base}/assign`, { method: "POST", body: JSON.stringify({ inviteeIds: ids, tableId }) });
    if (!ok) { setMsg({ kind: "error", text: r.error || "Something went wrong." }); return; }
    const parts = [];
    const what = r.seated ? (tableId ? `Seated ${r.seated} at ${tableLabel(tableId)}` : `Unseated ${r.seated}`) : "";
    if (what) parts.push(`${what}.`);
    if (r.requested) parts.push(`${r.requested} change${r.requested === 1 ? "" : "s"} sent to the event owner for approval.`);
    if (parts.length) setMsg({ kind: "info", text: parts.join(" ") });
    setSelectedGuests(new Set());
    const fresh = await load();
    // Only guests whose table really changed go into undo — changes sent for approval didn't happen yet.
    if (fresh) recordSeating(was, tablesOf(fresh.guests, ids), what);
  }

  /** Who sits where right now, for the given guests (null = no table). */
  function tablesOf(guests: SeatingGuest[], ids: string[]): Record<string, string | null> {
    const want = new Set(ids);
    return Object.fromEntries(guests.filter((g) => want.has(g.id)).map((g) => [g.id, g.table_id]));
  }
  function recordSeating(before: Record<string, string | null>, after: Record<string, string | null>, label: string) {
    const moved = Object.keys(after).filter((id) => id in before && before[id] !== after[id]);
    if (!moved.length) return;
    record({
      before: {}, after: {}, label,
      guests: { before: Object.fromEntries(moved.map((id) => [id, before[id]])), after: Object.fromEntries(moved.map((id) => [id, after[id]])) },
    });
  }

  /** Owner/admin: let guests see their table (name, tablemates, place on the floor) on their link. */
  async function shareWithGuests(on: boolean) {
    setData((prev) => prev && { ...prev, guestsCanSee: on });
    const { ok, data: r } = await call(base, { method: "PATCH", body: JSON.stringify({ guestsCanSee: on }) });
    if (!ok) { setMsg({ kind: "error", text: r.error || "That didn't save." }); await load(); return; }
    setMsg({ kind: "info", text: on ? "Guests can now see their table on their invitation link." : "Seating is hidden from guests again." });
  }

  /** Owner/admin: guests at one table trade places with guests at another. */
  async function swap(a: string[], b: string[]) {
    setMsg(null);
    const { ok, data: r } = await call(`${base}/swap`, { method: "POST", body: JSON.stringify({ a, b }) });
    if (!ok) { setMsg({ kind: "error", text: r.error || "Something went wrong." }); await load(); return false; }
    const label = `Swapped ${a.length} guest${a.length === 1 ? "" : "s"} with ${b.length}`;
    setMsg({ kind: "info", text: `${label}.` });
    await load();
    record({ before: {}, after: {}, label, swap: { a, b } });
    return true;
  }

  // ---------- undo / redo (floor layout and guest seating, one history) ----------
  // A layout step is the before/after state of every item it touched (null = didn't exist). Undo
  // writes `before` back through /items/sync (same ids), redo writes `after`. Deleting tables also
  // remembers who sat there, so undoing it re-seats them (if they haven't been given a table since).
  // A seating step is each moved guest's table before/after (null = no table), replayed through
  // /assign; a swap step is undone (and redone) by swapping the same two sets back.
  type Snap = SeatingItem | null;
  interface Step {
    before: Record<string, Snap>; after: Record<string, Snap>; seats?: Record<string, string[]>;
    label?: string;
    guests?: { before: Record<string, string | null>; after: Record<string, string | null> };
    swap?: { a: string[]; b: string[] };
  }
  const undoStack = useRef<Step[]>([]);
  const redoStack = useRef<Step[]>([]);
  const [, setHistoryTick] = useState(0);
  const [restoring, setRestoring] = useState(false);
  const snap = (list: SeatingItem[]) => Object.fromEntries(list.map((i) => [i.id, { ...i }])) as Record<string, Snap>;
  const gone = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, null])) as Record<string, Snap>;
  function record(step: Step) {
    undoStack.current.push(step);
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    setHistoryTick((n) => n + 1);
  }

  async function restore(target: Record<string, Snap>, seats?: Record<string, string[]>): Promise<boolean> {
    const upsert = Object.values(target).filter((i): i is SeatingItem => !!i).map((i) => ({
      id: i.id, kind: i.kind, shape: i.shape, label: i.label, capacity: i.capacity, assembly_id: i.assembly_id,
      x: i.x, y: i.y, width: i.width, height: i.height, rotation: i.rotation, color: i.color,
    }));
    const del = Object.entries(target).filter(([, v]) => !v).map(([k]) => k);
    const { ok, data: r } = await call(`${base}/items/sync`, { method: "POST", body: JSON.stringify({ upsert, delete: del }) });
    if (!ok) { setMsg({ kind: "error", text: r.error || "That couldn't be undone." }); await load(); return false; }
    if (seats) {
      const fresh = await call(base);
      const free = new Set<string>((fresh.data.guests || []).filter((g: SeatingGuest) => !g.table_id).map((g: SeatingGuest) => g.id));
      const failed: string[] = [];
      for (const [tableId, ids] of Object.entries(seats)) {
        const back = ids.filter((id) => free.has(id));
        if (!target[tableId] || back.length === 0) continue;
        const res = await call(`${base}/assign`, { method: "POST", body: JSON.stringify({ inviteeIds: back, tableId }) });
        if (!res.ok) failed.push(res.data.error || "");
      }
      if (failed.length) setMsg({ kind: "error", text: `The tables are back, but some guests couldn't be re-seated: ${failed.join(" ")}` });
    }
    await load();
    return true;
  }

  /** Put guests back at `target` tables — but only those still where `expect` says (someone else
   * may have moved them since; those are left alone and mentioned). */
  async function restoreSeating(target: Record<string, string | null>, expect: Record<string, string | null>, verb: "Undid" | "Redid", label?: string): Promise<boolean> {
    const now = new Map((d?.guests || []).map((g) => [g.id, g.table_id]));
    const ids = Object.keys(target).filter((id) => now.has(id) && now.get(id) === expect[id]);
    const skipped = Object.keys(target).length - ids.length;
    // Unseat first, so guests going back to a table never wait on chairs others are about to free.
    const byTable = new Map<string | null, string[]>();
    for (const id of ids) byTable.set(target[id], [...(byTable.get(target[id]) || []), id]);
    const order = [...byTable.keys()].sort((a, b) => (a === null ? -1 : b === null ? 1 : 0));
    let seated = 0, requested = 0;
    const errors: string[] = [];
    for (const tid of order) {
      const r = await call(`${base}/assign`, { method: "POST", body: JSON.stringify({ inviteeIds: byTable.get(tid), tableId: tid }) });
      if (!r.ok) errors.push(r.data.error || "Something went wrong.");
      else { seated += r.data.seated || 0; requested += r.data.requested || 0; }
    }
    await load();
    const parts = [];
    if (seated) parts.push(`${verb}: ${label || "seating change"}.`);
    if (requested) parts.push(`${requested} change${requested === 1 ? "" : "s"} sent to the event owner for approval.`);
    if (skipped) parts.push(`${skipped} guest${skipped === 1 ? " was" : "s were"} moved by someone else since, so left where they are.`);
    if (errors.length) setMsg({ kind: "error", text: [...errors, ...parts].join(" ") });
    else if (parts.length) setMsg({ kind: "info", text: parts.join(" ") });
    return seated > 0;
  }

  async function swapBack(step: Step, verb: "Undid" | "Redid"): Promise<boolean> {
    const { ok, data: r } = await call(`${base}/swap`, { method: "POST", body: JSON.stringify(step.swap) });
    await load();
    if (!ok) { setMsg({ kind: "error", text: r.error || "That couldn't be undone." }); return false; }
    setMsg({ kind: "info", text: `${verb}: ${step.label}.` });
    return true;
  }

  async function undo() {
    if (restoring) return;
    await flushNudges();
    const step = undoStack.current.pop();
    if (!step) return;
    setRestoring(true);
    const ok = step.swap ? await swapBack(step, "Undid")
      : step.guests ? await restoreSeating(step.guests.before, step.guests.after, "Undid", step.label)
      : await restore(step.before, step.seats);
    if (ok) redoStack.current.push(step);
    setRestoring(false);
    setHistoryTick((n) => n + 1);
  }
  async function redo() {
    if (restoring) return;
    const step = redoStack.current.pop();
    if (!step) return;
    setRestoring(true);
    const ok = step.swap ? await swapBack(step, "Redid")
      : step.guests ? await restoreSeating(step.guests.after, step.guests.before, "Redid", step.label)
      : await restore(step.after);
    if (ok) undoStack.current.push(step);
    setRestoring(false);
    setHistoryTick((n) => n + 1);
  }

  // ---------- layout edits ----------
  function setItemLocal(id: string, patch: Partial<SeatingItem>) {
    setData((prev) => prev && { ...prev, items: prev.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  }

  async function patchItem(id: string, patch: Partial<SeatingItem>) {
    const item = itemById.get(id);
    if (!item) return;
    if (patch.shape) {
      const def = (item.kind === "table" ? TABLE_SHAPES : FIXTURE_SHAPES)[patch.shape];
      // Line ↔ line (wall, door, window, arrow…) keeps the drawn length and angle; anything else
      // takes the new shape's default size.
      const lineToLine = LINE_SHAPES.has(item.shape) && LINE_SHAPES.has(patch.shape);
      if (def) patch = lineToLine ? { ...patch, height: def.height } : { ...patch, width: def.width, height: def.height };
    }
    setItemLocal(id, patch);
    const { ok, data: r } = await call(`${base}/items/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    if (!ok) setMsg({ kind: "error", text: r.error || "That change didn't save." });
    else record({ before: snap([item]), after: snap([{ ...item, ...patch }]) });
    // Clone set-asides can make pending requests stale, and the inspector's inputs follow the item.
    if (!ok || "assembly_id" in patch || "shape" in patch) await load();
  }

  async function createItems(newItems: Omit<SeatingItem, "id">[]): Promise<string | null> {
    const { ok, data: r } = await call(`${base}/items`, { method: "POST", body: JSON.stringify({ items: newItems }) });
    if (!ok) return r.error || "Something went wrong.";
    const made: SeatingItem[] = r.items || [];
    record({ before: gone(made.map((i) => i.id)), after: snap(made) });
    await load();
    if (made.length === 1) selectOne(made[0].id);
    return null;
  }

  async function addOne(kind: SeatingKind, shape: string) {
    const def = (kind === "table" ? TABLE_SHAPES : FIXTURE_SHAPES)[shape];
    const [pos] = placeBelow(items, 1, def.width, def.height);
    const err = await createItems([{
      kind, shape, ...pos, width: def.width, height: def.height, rotation: 0, color: null,
      label: kind === "table" ? `Table ${nextTableNumber(items)}` : def.label,
      capacity: kind === "table" ? def.seats ?? 8 : null, assembly_id: null,
    }]);
    if (err) setMsg({ kind: "error", text: err });
  }

  async function generateTables(spec: GenerateSpec) {
    const def = TABLE_SHAPES[spec.shape];
    const start = nextTableNumber(items);
    return createItems(placeBelow(items, spec.count, def.width, def.height).map((pos, n) => ({
      kind: "table" as const, shape: spec.shape, ...pos, width: def.width, height: def.height, rotation: 0, color: null,
      label: `${spec.prefix} ${start + n}`, capacity: spec.seats, assembly_id: spec.assemblyId,
    })));
  }

  async function duplicate(item: SeatingItem) {
    const { id: _id, ...rest } = item;
    const err = await createItems([{ ...rest, x: item.x + item.width + 40, y: item.y, label: item.kind === "table" ? `Table ${nextTableNumber(items)}` : item.label }]);
    if (err) setMsg({ kind: "error", text: err });
  }

  /** Delete items (one or many); undo brings them back with their guests. */
  async function deleteItems(doomed: SeatingItem[]) {
    const guests = doomed.reduce((n, i) => n + (d?.usage[i.id]?.guests || 0), 0);
    const what = doomed.length === 1 ? doomed[0].label : `${doomed.length} items`;
    if (guests && !confirm(`Delete ${what}? ${guests} seated guest${guests === 1 ? "" : "s"} will need a new table (Undo puts them back).`)) return;
    const seats = Object.fromEntries(doomed.filter((i) => i.kind === "table").map((i) => [i.id, (guestsAt.get(i.id) || []).map((g) => g.id)]));
    const { ok, data: r } = await call(`${base}/items`, { method: "DELETE", body: JSON.stringify({ ids: doomed.map((i) => i.id) }) });
    if (!ok) setMsg({ kind: "error", text: r.error || "Something went wrong." });
    else record({ before: snap(doomed), after: gone(doomed.map((i) => i.id)), seats });
    setSelectedIds(new Set());
    await load();
  }
  const remove = (item: SeatingItem) => deleteItems([item]);
  async function removeMany() {
    const doomed = items.filter((i) => selectedIds.has(i.id));
    if (doomed.length) await deleteItems(doomed);
  }

  // ---------- several items ----------
  async function moveItems(moves: { id: string; x: number; y: number }[]) {
    if (moves.length === 0) return;
    const at = new Map(moves.map((m) => [m.id, m]));
    const before = items.filter((i) => at.has(i.id));
    setData((prev) => prev && { ...prev, items: prev.items.map((i) => (at.has(i.id) ? { ...i, x: at.get(i.id)!.x, y: at.get(i.id)!.y } : i)) });
    const { ok, data: r } = await call(`${base}/items`, { method: "PATCH", body: JSON.stringify({ updates: moves }) });
    if (!ok) { setMsg({ kind: "error", text: r.error || "That move didn't save." }); await load(); return; }
    record({ before: snap(before), after: snap(before.map((i) => ({ ...i, x: at.get(i.id)!.x, y: at.get(i.id)!.y }))) });
  }

  /** Resize / rotate / line ends, from the handles. */
  const reshapeItem = (id: string, box: Box) => patchItem(id, box);

  /** Arrow keys: move the selection by one grid step (5 with Shift) right away; save after a pause,
   * as one undo step however many presses it took. */
  const nudgeBefore = useRef<Record<string, Snap>>({});
  function nudge(dx: number, dy: number) {
    if (!d) return;
    const group = d.items.filter((i) => selectedIds.has(i.id));
    if (group.length === 0) return;
    const delta = clampGroupDelta(group, dx, dy);
    if (!delta.dx && !delta.dy) return;
    group.forEach((i) => { nudged.current.add(i.id); if (!(i.id in nudgeBefore.current)) nudgeBefore.current[i.id] = { ...i }; });
    setData((prev) => prev && { ...prev, items: prev.items.map((i) => (selectedIds.has(i.id) ? { ...i, x: i.x + delta.dx, y: i.y + delta.dy } : i)) });
    clearTimeout(nudgeTimer.current);
    nudgeTimer.current = setTimeout(flushNudges, 400);
  }

  const latest = useRef(data);
  latest.current = data;
  async function flushNudges() {
    clearTimeout(nudgeTimer.current);
    const ids = nudged.current, before = nudgeBefore.current;
    nudged.current = new Set();
    nudgeBefore.current = {};
    const now = (latest.current?.items || []).filter((i) => ids.has(i.id));
    if (!now.length) return;
    const { ok, data: r } = await call(`${base}/items`, { method: "PATCH", body: JSON.stringify({ updates: now.map((i) => ({ id: i.id, x: i.x, y: i.y })) }) });
    if (!ok) { setMsg({ kind: "error", text: r.error || "That move didn't save." }); await load(); return; }
    record({ before, after: snap(now) });
  }

  async function setAsideMany(assemblyId: string | null) {
    const chosen = items.filter((i) => selectedIds.has(i.id) && i.kind === "table");
    if (!chosen.length) return;
    const { ok, data: r } = await call(`${base}/items`, { method: "PATCH", body: JSON.stringify({ updates: chosen.map((i) => ({ id: i.id, assembly_id: assemblyId })) }) });
    if (!ok) setMsg({ kind: "error", text: r.error || "Something went wrong." });
    else record({ before: snap(chosen), after: snap(chosen.map((i) => ({ ...i, assembly_id: assemblyId }))) });
    await load();
  }

  async function drawStructure(shape: string, box: Box) {
    const err = await createItems([{ kind: "fixture", shape, label: FIXTURE_SHAPES[shape].label, capacity: null, assembly_id: null, color: null, ...box }]);
    if (err) setMsg({ kind: "error", text: err });
    // A text box is placed one at a time: stop drawing so the planner can type into it.
    if (shape === "text") setDrawTool(null);
  }

  async function decide(id: string, action: "approve" | "reject" | "withdraw") {
    const { ok, data: r } = await call(`${base}/requests/${id}`, { method: "POST", body: JSON.stringify({ action }) });
    setMsg(ok ? null : { kind: "error", text: r.error || "Something went wrong." });
    await load();
  }

  async function decideAll(action: "approve_all" | "reject_all") {
    const { ok, data: r } = await call(`${base}/requests`, { method: "POST", body: JSON.stringify({ action }) });
    if (!ok) setMsg({ kind: "error", text: r.error || "Something went wrong." });
    else if (r.failed?.length) setMsg({ kind: "error", text: `${r.done} done. Couldn't apply: ${r.failed.map((f: any) => `${f.name} (${f.error})`).join("; ")}` });
    else setMsg({ kind: "info", text: `${r.done} request${r.done === 1 ? "" : "s"} ${action === "approve_all" ? "approved" : "rejected"}.` });
    await load();
  }

  // ---------- keyboard ----------
  const floorBox = useRef<HTMLDivElement>(null);
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.closest("input, textarea, select, [contenteditable=true]") || t.closest("[role=dialog]"))) return;
    if (e.key === "Escape") {
      if (drawTool) setDrawTool(null); else if (selectedIds.size) setSelectedIds(new Set());
      return;
    }
    const k = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && (k === "z" || k === "y") && (me?.canEditLayout || me?.canSeat)) {
      e.preventDefault();
      if (k === "y" || e.shiftKey) redo(); else undo();
      return;
    }
    if (!me?.canEditLayout || view !== "floor") return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && floorBox.current?.contains(document.activeElement)) {
      e.preventDefault();
      setSelectedIds(new Set(items.map((i) => i.id)));
      return;
    }
    if (selectedIds.size === 0) return;
    const step = e.shiftKey ? GRID * 5 : GRID;
    const dir = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, number[]>)[e.key];
    if (dir) { e.preventDefault(); nudge(dir[0], dir[1]); return; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeMany(); }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []);
  // Don't lose a nudge that's still waiting to save when the page goes away.
  useEffect(() => () => { if (nudged.current.size) flushNudges(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- zoom ----------
  // Trackpad pinch (Chrome/Edge/Firefox send it as a wheel event with ctrlKey; Safari as gesture
  // events) and Ctrl/⌘ + mouse wheel zoom the floor around the pointer: the floor point under it
  // stays under it. A plain wheel/two-finger swipe still scrolls.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const zoomAnchor = useRef<{ fx: number; fy: number; cx: number; cy: number } | null>(null);
  const zoomAt = useCallback((next: number, clientX?: number, clientY?: number) => {
    const box = floorBox.current, z = zoomRef.current;
    const n = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)) * 1000) / 1000;
    if (n === z) return;
    if (box) {
      const r = box.getBoundingClientRect();
      const cx = (clientX ?? r.left + box.clientWidth / 2) - r.left - box.clientLeft;
      const cy = (clientY ?? r.top + box.clientHeight / 2) - r.top - box.clientTop;
      zoomAnchor.current = { fx: (box.scrollLeft + cx) / z, fy: (box.scrollTop + cy) / z, cx, cy };
    }
    zoomRef.current = n;
    setZoom(n);
  }, []);
  useLayoutEffect(() => {
    const a = zoomAnchor.current, box = floorBox.current;
    zoomAnchor.current = null;
    if (a && box) { box.scrollLeft = a.fx * zoom - a.cx; box.scrollTop = a.fy * zoom - a.cy; }
  }, [zoom]);
  const floorShown = view === "floor" && !!d && d.items.length > 0;
  useEffect(() => {
    const box = floorBox.current;
    if (!box) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault(); // otherwise the browser zooms the whole page
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      // A pinch sends many small deltas; a mouse wheel notch sends ~100 — cap it to a gentle step.
      zoomAt(zoomRef.current * Math.exp(-Math.max(-25, Math.min(25, dy)) * 0.01), e.clientX, e.clientY);
    };
    let start = 1;
    const gStart = (e: Event) => { e.preventDefault(); start = zoomRef.current; };
    const gChange = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      zoomAt(start * g.scale, g.clientX, g.clientY);
    };
    box.addEventListener("wheel", wheel, { passive: false });
    box.addEventListener("gesturestart", gStart);
    box.addEventListener("gesturechange", gChange);
    box.addEventListener("gestureend", gStart);
    return () => {
      box.removeEventListener("wheel", wheel);
      box.removeEventListener("gesturestart", gStart);
      box.removeEventListener("gesturechange", gChange);
      box.removeEventListener("gestureend", gStart);
    };
  }, [floorShown, zoomAt]);

  // ---------- exports ----------
  const showClone = !isScoped && (d?.clones.length || 0) > 0;
  const context = [eventName, ...(isScoped ? [cloneById.get(me!.assemblyId!)?.name || ""] : [])].filter(Boolean);
  const byName = (): ExportDoc => {
    const seated = (d?.guests || []).filter((g) => g.table_id)
      .sort((a, b) => (a.last_name || a.first_name).localeCompare(b.last_name || b.first_name) || a.first_name.localeCompare(b.first_name));
    return {
      title: "Seating — by guest", context, fileBase: `${eventName}-seating-by-guest`,
      tables: [{
        name: "Guests",
        columns: [{ label: "Guest" }, { label: "Table" }, { label: "Party", align: "right" }, ...(showClone ? [{ label: "Clone" }] : [])],
        rows: seated.map((g) => [fullName(g.first_name, g.last_name), tableLabel(g.table_id), seatsFor(g), ...(showClone ? [g.assembly_id ? cloneById.get(g.assembly_id)?.name || "" : ""] : [])]),
      }],
    };
  };
  const byTable = (): ExportDoc => {
    const visibleTables = [...tables].sort(byLabel).filter((t) => !isScoped || t.assembly_id === me!.assemblyId);
    const unseated = (d?.guests || []).filter((g) => !g.table_id && g.rsvp_status === "attending");
    return {
      title: "Seating — by table", context, fileBase: `${eventName}-seating-by-table`,
      tables: [
        ...visibleTables.map((t) => ({
          name: `${t.label} (${d?.usage[t.id]?.seats || 0}/${t.capacity ?? "∞"})`,
          columns: [{ label: "Guest" }, { label: "Party", align: "right" as const }],
          rows: (guestsAt.get(t.id) || []).map((g) => [fullName(g.first_name, g.last_name), seatsFor(g)]),
        })),
        ...(unseated.length ? [{ name: "Attending, no table yet", columns: [{ label: "Guest" }, { label: "Party", align: "right" as const }], rows: unseated.map((g) => [fullName(g.first_name, g.last_name), seatsFor(g)]) }] : []),
      ],
    };
  };

  // ---------- render ----------
  if (loadError) return <div className="p-4 sm:p-8"><p className="rounded border border-clay-500/30 bg-clay-500/5 text-clay-600 text-sm px-3 py-2.5">{loadError}</p></div>;
  if (!d || !me) return <div className="p-4 sm:p-8 text-sm text-ink-faint">Loading seating…</div>;

  const selected = selectedIds.size === 1 ? itemById.get([...selectedIds][0]) : undefined;
  const multi = items.filter((i) => selectedIds.has(i.id));
  const multiTables = multi.filter((i) => i.kind === "table");
  const inspector = selected && (
    <TableInspector
      key={`${selected.id}-${selected.label}-${selected.capacity}-${selected.width}-${selected.height}-${selected.rotation}`}
      item={selected}
      canEditLayout={me.canEditLayout}
      canSeat={me.canSeat && look(selected).enabled}
      clones={d.clones}
      isScoped={isScoped}
      seated={guestsAt.get(selected.id) || []}
      otherTables={[...tables].sort(byLabel).filter((t) => t.id !== selected.id && look(t).enabled)
        .map((t) => ({ id: t.id, label: t.label, used: d.usage[t.id]?.seats || 0, capacity: t.capacity }))}
      guestsAt={(id) => guestsAt.get(id) || []}
      canSwap={!isScoped}
      usage={d.usage[selected.id] || { seats: 0, guests: 0 }}
      incoming={d.requests.filter((r) => r.to_table_id === selected.id)}
      tableLabel={tableLabel}
      onPatch={(p) => patchItem(selected.id, p)}
      onDuplicate={() => duplicate(selected)}
      onDelete={() => remove(selected)}
      onUnseat={(ids) => seat(ids, null)}
      onMoveTo={(ids, tid) => seat(ids, tid)}
      onSwap={swap}
      onClose={() => setSelectedIds(new Set())}
    />
  );
  const seatMode = me.canSeat && selectedGuests.size > 0;

  return (
    <div className="p-4 sm:p-8 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl text-ink">Seating</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {me.canEditLayout
              ? "Lay out the room, then drag guests onto tables."
              : isScoped
                ? "Seat your clone's guests at the tables set aside for you. Moving someone who already has a table needs the event owner's approval."
                : "View-only: see the floor plan and who's sitting where."}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded border border-paper-line overflow-hidden text-sm">
            {(["floor", "list"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={cn("px-3 py-1.5", view === v ? "bg-wine-50 text-wine-700 font-medium" : "text-ink-soft hover:bg-paper-soft")}>
                {v === "floor" ? "Floor plan" : "Tables list"}
              </button>
            ))}
          </div>
          {me.canEditLayout && <AddMenu onAdd={addOne} onSeveral={() => setGenerate(Math.max(1, Math.ceil((summary.attendingSeats - summary.capacity) / summary.typicalSize)))} />}
          <SeatingExportMenu eventName={eventName} floorRef={floorRef} byName={byName} byTable={byTable} />
        </div>
      </div>

      {msg && (
        <div className={cn("rounded px-3 py-2.5 text-sm flex justify-between gap-3", msg.kind === "error" ? "border border-clay-500/30 bg-clay-500/5 text-clay-600" : "border border-moss-100 bg-moss-50 text-moss-600")} role="status">
          <span>{msg.text}</span>
          <button onClick={() => setMsg(null)} aria-label="Dismiss" className="shrink-0">×</button>
        </div>
      )}

      <RequestsPanel requests={d.requests} canApprove={me.canApprove} isScoped={isScoped} tableLabel={tableLabel} onDecide={decide} onDecideAll={decideAll} />

      <div className="grid gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <SeatingSummary n={summary} onGenerate={me.canEditLayout ? (k) => setGenerate(k) : undefined} />
          {me.canEditLayout && (
            <label className="card p-4 flex items-start gap-3 cursor-pointer">
              <input type="checkbox" className="mt-1" checked={d.guestsCanSee} onChange={(e) => shareWithGuests(e.target.checked)} />
              <span>
                <span className="block text-sm font-medium text-ink">Show guests their table</span>
                <span className="block mt-0.5 text-xs text-ink-faint leading-relaxed">
                  Attending guests who have a table see it on their invitation link: the table name, who else sits there, and where it is in the room (other tables blurred).
                </span>
              </span>
            </label>
          )}
          <div className="lg:h-[calc(100vh-22rem)] lg:min-h-[24rem] max-lg:max-h-[60vh] flex flex-col">
            <GuestPanel
              guests={d.guests}
              clones={isScoped ? [] : d.clones}
              canSeat={me.canSeat}
              selected={selectedGuests}
              onSelect={setSelectedGuests}
              pendingIds={pendingIds}
              tableLabel={tableLabel}
              onUnseat={(ids) => seat(ids, null)}
            />
          </div>
        </div>

        <div className="min-w-0 space-y-3">
          {tables.length === 0 && items.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="font-serif text-lg text-ink">No floor plan yet</p>
              {me.canEditLayout ? (
                <>
                  <p className="mt-1 text-sm text-ink-soft">Start by adding tables — we&apos;ll suggest how many from your attending headcount.</p>
                  <button className="btn-primary mt-4" onClick={() => setGenerate(Math.max(1, Math.ceil(summary.attendingSeats / 8)))}>Add tables</button>
                </>
              ) : (
                <p className="mt-1 text-sm text-ink-soft">The event owner hasn&apos;t laid out the tables yet.</p>
              )}
            </div>
          ) : view === "floor" ? (
            <>
              {me.canEditLayout && (
                <DrawToolbar
                  drawTool={drawTool}
                  onTool={(t) => { setDrawTool(t); if (t) setSelectedIds(new Set()); }}
                  canUndo={undoStack.current.length > 0 || nudged.current.size > 0}
                  canRedo={redoStack.current.length > 0}
                  busy={restoring}
                  onUndo={undo}
                  onRedo={redo}
                />
              )}
              {multi.length > 1 && me.canEditLayout && (
                <div className="flex items-center gap-3 flex-wrap rounded border border-wine-100 bg-wine-50 px-3 py-2 text-sm">
                  <span className="font-medium text-wine-700">{multi.length} selected</span>
                  <span className="text-xs text-ink-faint">Drag any of them, or use the arrow keys (Shift for bigger steps).</span>
                  <div className="ml-auto flex items-center gap-2">
                    {multiTables.length > 0 && d.clones.length > 0 && (
                      <select className="input py-1 text-xs w-auto" value="" aria-label="Set aside selected tables for a clone"
                        onChange={(e) => { if (e.target.value) setAsideMany(e.target.value === "none" ? null : e.target.value); }}>
                        <option value="">Set aside {multiTables.length} table{multiTables.length === 1 ? "" : "s"} for…</option>
                        {d.clones.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        <option value="none">No clone</option>
                      </select>
                    )}
                    <button className="btn-ghost py-1 px-2 text-xs text-clay-600 hover:text-clay-600" onClick={removeMany}>Delete</button>
                    <button className="btn-ghost py-1 px-2 text-xs" onClick={() => setSelectedIds(new Set())}>Clear</button>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                {!me.canEditLayout && me.canSeat && (
                  <div className="flex items-center gap-0.5">
                    <HistoryButtons canUndo={undoStack.current.length > 0} canRedo={redoStack.current.length > 0} busy={restoring} onUndo={undo} onRedo={redo} />
                  </div>
                )}
                <div className="relative w-full sm:w-80">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
                  <input
                    type="search"
                    className="input pl-8 py-1.5 text-sm"
                    placeholder="Find a seated guest…"
                    aria-label="Find a seated guest"
                    value={find}
                    onChange={(e) => { setFind(e.target.value); setFindOpen(true); }}
                    onFocus={() => setFindOpen(true)}
                    onBlur={() => setTimeout(() => setFindOpen(false), 150)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") { setFind(""); setFindOpen(false); }
                      if (e.key === "Enter" && found?.hits[0]) { goToTable(found.hits[0].table_id!); setFindOpen(false); }
                    }}
                  />
                  {findOpen && found && (
                    <div className="absolute left-0 right-0 z-40 mt-1 card max-h-72 overflow-auto py-1 text-sm" role="listbox" aria-label="Seated guests found">
                      {found.hits.length === 0 ? (
                        <p className="px-3 py-2 text-ink-faint">No seated guest matches &ldquo;{find.trim()}&rdquo;.</p>
                      ) : found.hits.map((g) => (
                        <button key={g.id} role="option" aria-selected={false}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => { goToTable(g.table_id!); setFindOpen(false); }}
                          className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-paper-soft">
                          <span className="min-w-0 truncate">
                            <span className="text-ink">{fullName(g.first_name, g.last_name)}</span>
                            {g.group_name && <span className="ml-1.5 text-xs text-ink-faint">{g.group_name}</span>}
                          </span>
                          <span className="shrink-0 text-xs font-medium text-wine-700">{tableLabel(g.table_id)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {found && (
                  <span className="text-xs text-ink-faint">
                    {found.hits.length === 0 ? "No matches" : `${found.hits.length} found at ${found.tables.size} table${found.tables.size === 1 ? "" : "s"}`}
                    <button className="ml-2 underline hover:text-ink" onClick={() => setFind("")}>Clear</button>
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 text-sm">
                <p className="text-ink-faint">
                  {drawTool
                    ? LINE_SHAPES.has(drawTool)
                      ? `Drag from one end of the ${FIXTURE_SHAPES[drawTool].label.toLowerCase()} to the other (angles snap to 15°). Esc when done.`
                      : `Drag to draw the ${FIXTURE_SHAPES[drawTool].label.toLowerCase()}, or click to drop one. Esc when done.`
                    : seatMode ? `Click a table to seat ${selectedGuests.size} selected.`
                    : me.canEditLayout ? (selected && selected.kind !== "table" ? "Drag the handles to resize or rotate. Shift-click or drag a box to select several items." : "Shift-click or drag a box to select several items. Drag guests onto tables.")
                    : me.canSeat ? "Drag guests onto a table, or select them and click a table." : "Click a table to see who's there."}
                </p>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={toggleNames} aria-pressed={showNames} title="Show each guest's name next to their chair"
                    className={cn("mr-2 rounded border px-2.5 py-1 text-xs", showNames ? "border-wine-200 bg-wine-50 text-wine-700 font-medium" : "border-paper-line text-ink-soft hover:bg-paper-soft")}>
                    {showNames ? "Hide names" : "Show names"}
                  </button>
                  <button className="btn-ghost h-8 w-8 p-0" aria-label="Zoom out" title="Zoom out (or pinch / Ctrl+scroll)" onClick={() => zoomAt(Math.round((zoom - 0.1) * 10) / 10)}>−</button>
                  <button className="text-xs text-ink-soft tabular-nums w-12" onClick={() => zoomAt(1)} title="Reset zoom">{Math.round(zoom * 100)}%</button>
                  <button className="btn-ghost h-8 w-8 p-0" aria-label="Zoom in" title="Zoom in (or pinch / Ctrl+scroll)" onClick={() => zoomAt(Math.round((zoom + 0.1) * 10) / 10)}>+</button>
                </div>
              </div>
              <div ref={floorWrap} className="relative">
                <div ref={floorBox} tabIndex={-1} className="card relative overflow-auto h-[calc(100vh-14rem)] min-h-[28rem] outline-none">
                  <FloorPlan
                    ref={floorRef}
                    items={items}
                    zoom={zoom}
                    selected={selectedIds}
                    canEditLayout={me.canEditLayout}
                    seatMode={seatMode}
                    showNames={showNames}
                    drawTool={drawTool}
                    highlight={found?.hits.length ? found.tables : null}
                    look={look}
                    onSelect={setSelectedIds}
                    onSeatSelected={(tid) => seat([...selectedGuests], tid)}
                    onDropGuests={(ids, tid) => seat(ids, tid)}
                    onMove={moveItems}
                    onDraw={drawStructure}
                    onReshape={reshapeItem}
                    onGesture={setGestureActive}
                  />
                </div>
                {wide && selected && (
                  <FloatingInspector
                    wrapRef={floorWrap}
                    scrollRef={floorBox}
                    itemId={selected.id}
                    layoutKey={`${selected.x},${selected.y},${selected.width},${selected.height},${selected.rotation},${selected.shape},${zoom},${d.usage[selected.id]?.guests || 0}`}
                    hidden={gestureActive}
                    onDocked={setDocked}
                  >
                    {inspector}
                  </FloatingInspector>
                )}
              </div>
              {/* No clear spot over the floor (or a narrow screen): the inspector sits below it instead,
                  so it never covers the selected item. */}
              {selected && (!wide || docked) && <div className="max-w-xl">{inspector}</div>}
              <Legend clones={d.clones} isScoped={isScoped} anyNoClone={d.guests.some((g) => g.table_id && !g.assembly_id)} />
            </>
          ) : (
            <TableListView
              tables={[...tables].sort(byLabel)}
              look={look}
              seatedAt={(id) => guestsAt.get(id) || []}
              usage={d.usage}
              selectedCount={me.canSeat ? selectedGuests.size : 0}
              onSeatHere={(tid) => seat([...selectedGuests], tid)}
              onOpen={selectOne}
            />
          )}
        </div>
      </div>

      {selected && view === "list" && (
        <Modal title={selected.label} onClose={() => setSelectedIds(new Set())}>{inspector}</Modal>
      )}
      {generate !== null && (
        <GenerateTablesModal suggested={generate} clones={d.clones} onClose={() => setGenerate(null)} onCreate={generateTables} />
      )}
    </div>
  );
}

function AddMenu({ onAdd, onSeveral }: { onAdd: (kind: SeatingKind, shape: string) => void; onSeveral: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const pick = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <div ref={ref} className="relative">
      <button className="btn-primary py-1.5 text-sm" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>+ Add</button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-60 card py-1 max-h-[70vh] overflow-y-auto">
          <button role="menuitem" className="block w-full px-4 py-2 text-left text-sm font-medium text-wine-600 hover:bg-paper-soft" onClick={pick(onSeveral)}>Several tables at once…</button>
          <p className="px-4 pt-2 pb-1 text-[11px] uppercase tracking-wide text-ink-faint">Table</p>
          {Object.entries(TABLE_SHAPES).map(([k, s]) => (
            <button key={k} role="menuitem" className="block w-full px-4 py-1.5 text-left text-sm text-ink hover:bg-paper-soft" onClick={pick(() => onAdd("table", k))}>{s.label} <span className="text-ink-faint">· {s.seats} seats</span></button>
          ))}
          <p className="px-4 pt-2 pb-1 text-[11px] uppercase tracking-wide text-ink-faint">Room</p>
          {Object.entries(FIXTURE_SHAPES).filter(([k]) => !(STRUCTURE_TOOLS as readonly string[]).includes(k)).map(([k, s]) => (
            <button key={k} role="menuitem" className="block w-full px-4 py-1.5 text-left text-sm text-ink hover:bg-paper-soft" onClick={pick(() => onAdd("fixture", k))}>{s.label}</button>
          ))}
          <p className="px-4 pt-2 pb-1 text-[11px] uppercase tracking-wide text-ink-faint">Structures <span className="normal-case tracking-normal">· or use Draw</span></p>
          {STRUCTURE_TOOLS.map((k) => (
            <button key={k} role="menuitem" className="block w-full px-4 py-1.5 text-left text-sm text-ink hover:bg-paper-soft" onClick={pick(() => onAdd("fixture", k))}>{FIXTURE_SHAPES[k].label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function Legend({ clones, isScoped, anyNoClone }: { clones: { id: string; name: string; index: number }[]; isScoped: boolean; anyNoClone: boolean }) {
  const dot = (color: string) => <span className="h-3 w-3 rounded-full border border-ink/30" style={{ backgroundColor: color }} />;
  return (
    <div className="space-y-1 text-xs text-ink-soft">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {clones.length === 0 && <span className="inline-flex items-center gap-1.5">{dot(SEAT_COLOR)}Taken seat</span>}
        {clones.map((c) => (
          <span key={c.id} className="inline-flex items-center gap-1.5">{dot(cloneColor(c.index))}{c.name}</span>
        ))}
        {clones.length > 0 && anyNoClone && <span className="inline-flex items-center gap-1.5">{dot(NO_CLONE_SEAT_COLOR)}No clone</span>}
        {isScoped && <span className="inline-flex items-center gap-1.5">{dot(HIDDEN_SEAT_COLOR)}Other clones&apos; guests</span>}
        <span className="inline-flex items-center gap-1.5"><span className="h-4 min-w-4 px-1 rounded-full bg-clay-500 text-paper text-[9px] font-semibold flex items-center justify-center">!</span>Needs a second look</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-4 min-w-4 px-1 rounded-full bg-brass-400 text-ink text-[9px] font-semibold flex items-center justify-center">+1</span>Awaiting approval</span>
      </div>
      {clones.length > 0 && (
        <p className="text-ink-faint">
          Each chair takes the color of the guest&apos;s clone. A table&apos;s outline shows the clone it&apos;s set aside for{isScoped && <>; faded tables belong to other clones</>}.
        </p>
      )}
    </div>
  );
}
