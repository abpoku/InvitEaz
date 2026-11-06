"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn, fullName } from "@/lib/utils";
import {
  FIXTURE_SHAPES, LINE_SHAPES, STRUCTURE_TOOLS, TABLE_SHAPES, clampGroupDelta, cloneColor, guestWarning, nextTableNumber,
  placeBelow, seatsFor, GRID, type Box, type SeatingGuest, type SeatingItem, type SeatingKind,
} from "@/lib/seating";
import type { ExportDoc } from "@/lib/table-export";
import { Modal } from "@/components/Modal";
import { FloorPlan, type TableLook } from "./FloorPlan";
import { GuestPanel } from "./GuestPanel";
import { TableInspector } from "./TableInspector";
import { RequestsPanel } from "./RequestsPanel";
import { SeatingSummary } from "./SeatingSummary";
import { GenerateTablesModal, type GenerateSpec } from "./GenerateTablesModal";
import { SeatingExportMenu } from "./SeatingExportMenu";
import { TableListView } from "./TableListView";
import { DrawToolbar } from "./DrawToolbar";
import { FloatingInspector } from "./FloatingInspector";
import type { SeatingData } from "./types";

type Msg = { kind: "error" | "info"; text: string } | null;

async function call(url: string, init?: RequestInit): Promise<{ ok: boolean; data: any }> {
  const res = await fetch(url, init?.body ? { ...init, headers: { "Content-Type": "application/json" } } : init);
  let data: any = {};
  try { data = await res.json(); } catch {}
  return { ok: res.ok, data };
}

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
    return m;
  }, [d]);
  const pendingTo = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of d?.requests || []) if (r.to_table_id) m.set(r.to_table_id, (m.get(r.to_table_id) || 0) + 1);
    return m;
  }, [d]);
  const pendingIds = useMemo(() => new Set((d?.requests || []).map((r) => r.invitee_id)), [d]);
  const tableLabel = useCallback((id: string | null) => (id ? itemById.get(id)?.label || "a removed table" : "no table"), [itemById]);

  const look = useCallback((t: SeatingItem): TableLook => {
    const clone = t.assembly_id ? cloneById.get(t.assembly_id) : undefined;
    return {
      used: d?.usage[t.id]?.seats || 0,
      pending: pendingTo.get(t.id) || 0,
      color: t.assembly_id ? (clone ? cloneColor(clone.index) : "#83879A") : null,
      enabled: !!me?.canSeat && (!me.assemblyId || t.assembly_id === me.assemblyId),
      warnings: (guestsAt.get(t.id) || []).filter((g) => guestWarning(g, t)).length,
    };
  }, [d, me, cloneById, pendingTo, guestsAt]);

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
    const { ok, data: r } = await call(`${base}/assign`, { method: "POST", body: JSON.stringify({ inviteeIds: ids, tableId }) });
    if (!ok) { setMsg({ kind: "error", text: r.error || "Something went wrong." }); return; }
    const parts = [];
    if (r.seated) parts.push(tableId ? `Seated ${r.seated} at ${tableLabel(tableId)}.` : `Unseated ${r.seated}.`);
    if (r.requested) parts.push(`${r.requested} change${r.requested === 1 ? "" : "s"} sent to the event owner for approval.`);
    if (parts.length) setMsg({ kind: "info", text: parts.join(" ") });
    setSelectedGuests(new Set());
    await load();
  }

  // ---------- undo / redo (floor layout only) ----------
  // Each step is the before/after state of every item it touched (null = didn't exist). Undo writes
  // `before` back through /items/sync (same ids), redo writes `after`. Deleting tables also remembers
  // who sat there, so undoing it re-seats them (if they haven't been given a table since).
  type Snap = SeatingItem | null;
  interface Step { before: Record<string, Snap>; after: Record<string, Snap>; seats?: Record<string, string[]> }
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

  async function undo() {
    if (restoring) return;
    await flushNudges();
    const step = undoStack.current.pop();
    if (!step) return;
    setRestoring(true);
    if (await restore(step.before, step.seats)) redoStack.current.push(step);
    setRestoring(false);
    setHistoryTick((n) => n + 1);
  }
  async function redo() {
    if (restoring) return;
    const step = redoStack.current.pop();
    if (!step) return;
    setRestoring(true);
    if (await restore(step.after)) undoStack.current.push(step);
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
    if (!me?.canEditLayout || view !== "floor") return;
    const k = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && (k === "z" || k === "y")) {
      e.preventDefault();
      if (k === "y" || e.shiftKey) redo(); else undo();
      return;
    }
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
      usage={d.usage[selected.id] || { seats: 0, guests: 0 }}
      incoming={d.requests.filter((r) => r.to_table_id === selected.id)}
      tableLabel={tableLabel}
      onPatch={(p) => patchItem(selected.id, p)}
      onDuplicate={() => duplicate(selected)}
      onDelete={() => remove(selected)}
      onUnseat={(ids) => seat(ids, null)}
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
              <div className="flex items-center justify-between gap-2 text-sm">
                <p className="text-ink-faint">
                  {drawTool
                    ? LINE_SHAPES.has(drawTool)
                      ? `Drag from one end of the ${FIXTURE_SHAPES[drawTool].label.toLowerCase()} to the other (angles snap to 15°). Esc when done.`
                      : `Drag to draw the ${FIXTURE_SHAPES[drawTool].label.toLowerCase()}, or click to drop one. Esc when done.`
                    : seatMode ? `Click a table to seat ${selectedGuests.size} selected.`
                    : me.canEditLayout ? (selected ? "Drag the handles to resize or rotate. Shift-click or drag a box to select several items." : "Shift-click or drag a box to select several items. Drag guests onto tables.")
                    : me.canSeat ? "Drag guests onto a table, or select them and click a table." : "Click a table to see who's there."}
                </p>
                <div className="flex items-center gap-1 shrink-0">
                  <button className="btn-ghost h-8 w-8 p-0" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.3, +(z - 0.1).toFixed(2)))}>−</button>
                  <button className="text-xs text-ink-soft tabular-nums w-12" onClick={() => setZoom(1)} title="Reset zoom">{Math.round(zoom * 100)}%</button>
                  <button className="btn-ghost h-8 w-8 p-0" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(2)))}>+</button>
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
                    drawTool={drawTool}
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
              <Legend clones={d.clones} isScoped={isScoped} />
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

function Legend({ clones, isScoped }: { clones: { id: string; name: string; index: number }[]; isScoped: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
      {clones.map((c) => (
        <span key={c.id} className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border-2" style={{ borderColor: cloneColor(c.index) }} />{c.name}</span>
      ))}
      {isScoped && <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border-2 border-ink-faint opacity-50" />Other clones&apos; tables</span>}
      <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-wine-400" />Taken seat</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-4 min-w-4 px-1 rounded-full bg-clay-500 text-paper text-[9px] font-semibold flex items-center justify-center">!</span>Needs a second look</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-4 min-w-4 px-1 rounded-full bg-brass-400 text-ink text-[9px] font-semibold flex items-center justify-center">+1</span>Awaiting approval</span>
    </div>
  );
}
