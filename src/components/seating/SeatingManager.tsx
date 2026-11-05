"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn, fullName } from "@/lib/utils";
import {
  FIXTURE_SHAPES, TABLE_SHAPES, cloneColor, guestWarning, nextTableNumber, placeBelow, seatsFor,
  type SeatingGuest, type SeatingItem, type SeatingKind,
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
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [selectedGuests, setSelectedGuests] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"floor" | "list">("floor");
  const [zoom, setZoom] = useState(1);
  const [generate, setGenerate] = useState<number | null>(null);
  const [wide, setWide] = useState(true);
  const floorRef = useRef<HTMLDivElement>(null);

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

  function setItemLocal(id: string, patch: Partial<SeatingItem>) {
    setData((prev) => prev && { ...prev, items: prev.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  }

  async function patchItem(id: string, patch: Partial<SeatingItem>) {
    if (patch.shape) {
      const item = itemById.get(id)!;
      const def = (item.kind === "table" ? TABLE_SHAPES : FIXTURE_SHAPES)[patch.shape];
      if (def) patch = { ...patch, width: def.width, height: def.height };
    }
    setItemLocal(id, patch);
    const { ok, data: r } = await call(`${base}/items/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    if (!ok) setMsg({ kind: "error", text: r.error || "That change didn't save." });
    // Clone set-asides can make pending requests stale, and the inspector's inputs follow the item.
    if (!ok || "assembly_id" in patch || "shape" in patch) await load();
  }

  async function createItems(newItems: Omit<SeatingItem, "id">[]): Promise<string | null> {
    const { ok, data: r } = await call(`${base}/items`, { method: "POST", body: JSON.stringify({ items: newItems }) });
    if (!ok) return r.error || "Something went wrong.";
    await load();
    if (r.items?.length === 1) setSelectedItem(r.items[0].id);
    return null;
  }

  async function addOne(kind: SeatingKind, shape: string) {
    const def = (kind === "table" ? TABLE_SHAPES : FIXTURE_SHAPES)[shape];
    const [pos] = placeBelow(items, 1, def.width, def.height);
    const err = await createItems([{
      kind, shape, ...pos, width: def.width, height: def.height, rotation: 0,
      label: kind === "table" ? `Table ${nextTableNumber(items)}` : def.label,
      capacity: kind === "table" ? def.seats ?? 8 : null, assembly_id: null,
    }]);
    if (err) setMsg({ kind: "error", text: err });
  }

  async function generateTables(spec: GenerateSpec) {
    const def = TABLE_SHAPES[spec.shape];
    const start = nextTableNumber(items);
    return createItems(placeBelow(items, spec.count, def.width, def.height).map((pos, n) => ({
      kind: "table" as const, shape: spec.shape, ...pos, width: def.width, height: def.height, rotation: 0,
      label: `${spec.prefix} ${start + n}`, capacity: spec.seats, assembly_id: spec.assemblyId,
    })));
  }

  async function duplicate(item: SeatingItem) {
    const { id: _id, ...rest } = item;
    const err = await createItems([{ ...rest, x: item.x + item.width + 40, y: item.y, label: item.kind === "table" ? `Table ${nextTableNumber(items)}` : item.label }]);
    if (err) setMsg({ kind: "error", text: err });
  }

  async function remove(item: SeatingItem) {
    const n = d?.usage[item.id]?.guests || 0;
    if (!confirm(n ? `Delete ${item.label}? Its ${n} guest${n === 1 ? "" : "s"} will need a new table.` : `Delete ${item.label}?`)) return;
    const { ok, data: r } = await call(`${base}/items/${item.id}`, { method: "DELETE" });
    if (!ok) setMsg({ kind: "error", text: r.error || "Something went wrong." });
    setSelectedItem(null);
    await load();
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

  const selected = selectedItem ? itemById.get(selectedItem) : undefined;
  const inspector = selected && (
    <TableInspector
      key={`${selected.id}-${selected.label}-${selected.capacity}-${selected.width}-${selected.height}`}
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
      onClose={() => setSelectedItem(null)}
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
              <div className="flex items-center justify-between gap-2 text-sm">
                <p className="text-ink-faint">
                  {seatMode ? `Click a table to seat ${selectedGuests.size} selected.` : me.canSeat ? "Drag guests onto a table, or select them and click a table." : "Click a table to see who's there."}
                </p>
                <div className="flex items-center gap-1 shrink-0">
                  <button className="btn-ghost h-8 w-8 p-0" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.3, +(z - 0.1).toFixed(2)))}>−</button>
                  <button className="text-xs text-ink-soft tabular-nums w-12" onClick={() => setZoom(1)} title="Reset zoom">{Math.round(zoom * 100)}%</button>
                  <button className="btn-ghost h-8 w-8 p-0" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(2)))}>+</button>
                </div>
              </div>
              <div className="relative">
                <div className="card relative overflow-auto h-[calc(100vh-14rem)] min-h-[28rem]">
                  <FloorPlan
                    ref={floorRef}
                    items={items}
                    zoom={zoom}
                    selectedId={selectedItem}
                    canEditLayout={me.canEditLayout}
                    seatMode={seatMode}
                    look={look}
                    onSelect={setSelectedItem}
                    onSeatSelected={(tid) => seat([...selectedGuests], tid)}
                    onDropGuests={(ids, tid) => seat(ids, tid)}
                    onMove={(id, x, y) => patchItem(id, { x, y })}
                  />
                </div>
                {wide && inspector && <div className="absolute right-3 top-3 w-72 max-h-[calc(100%-1.5rem)] overflow-y-auto z-20 shadow-lifted rounded-lg">{inspector}</div>}
              </div>
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
              onOpen={setSelectedItem}
            />
          )}
        </div>
      </div>

      {selected && (!wide || view === "list") && (
        <Modal title={selected.label} onClose={() => setSelectedItem(null)}>{inspector}</Modal>
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
          {Object.entries(FIXTURE_SHAPES).map(([k, s]) => (
            <button key={k} role="menuitem" className="block w-full px-4 py-1.5 text-left text-sm text-ink hover:bg-paper-soft" onClick={pick(() => onAdd("fixture", k))}>{s.label}</button>
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
