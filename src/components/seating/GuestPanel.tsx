"use client";

import { useMemo, useState } from "react";
import { cn, fullName } from "@/lib/utils";
import { seatsFor, type SeatingGuest } from "@/lib/seating";
import { GUEST_DRAG } from "./types";

export type StatusFilter = "attending" | "attending_maybe" | "all";

const STATUS_LABEL: Record<string, string> = { declined: "Declined", maybe: "Maybe" };

interface Props {
  guests: SeatingGuest[];
  clones: { id: string; name: string }[];
  canSeat: boolean;
  selected: Set<string>;
  onSelect: (next: Set<string>) => void;
  pendingIds: Set<string>;
  tableLabel: (id: string) => string;
  onUnseat: (ids: string[]) => void;
}

/** Who still needs a seat. Attending guests only by default; households (groups) are listed and
 * dragged as one unit so they stay together. Dropping seated guests back here unseats them. */
export function GuestPanel({ guests, clones, canSeat, selected, onSelect, pendingIds, tableLabel, onUnseat }: Props) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("attending");
  const [showSeated, setShowSeated] = useState(false);
  const [clone, setClone] = useState("");
  const [dropHover, setDropHover] = useState(false);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return guests.filter((g) => {
      if (status === "attending" && g.rsvp_status !== "attending") return false;
      if (status === "attending_maybe" && g.rsvp_status !== "attending" && g.rsvp_status !== "maybe") return false;
      if (!showSeated && g.table_id) return false;
      if (clone && (clone === "none" ? g.assembly_id : g.assembly_id !== clone)) return false;
      if (q && !fullName(g.first_name, g.last_name).toLowerCase().includes(q) && !(g.group_name || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [guests, search, status, showSeated, clone]);

  // Households first by name, then everyone not in a group.
  const units = useMemo(() => {
    const groups = new Map<string, { name: string; members: SeatingGuest[] }>();
    const singles: SeatingGuest[] = [];
    for (const g of visible) {
      if (!g.group_id) { singles.push(g); continue; }
      const u = groups.get(g.group_id) || { name: g.group_name || "Group", members: [] };
      u.members.push(g);
      groups.set(g.group_id, u);
    }
    return { groups: [...groups.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name)), singles };
  }, [visible]);

  function changeFilter(fn: () => void) { fn(); onSelect(new Set()); }

  function toggle(ids: string[], on: boolean) {
    const next = new Set(selected);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    onSelect(next);
  }

  function dragStart(e: React.DragEvent, ids: string[]) {
    // Dragging one of several selected guests carries the whole selection.
    const carry = ids.length === 1 && selected.has(ids[0]) ? [...selected] : ids;
    e.dataTransfer.setData(GUEST_DRAG, JSON.stringify(carry));
    e.dataTransfer.effectAllowed = "move";
  }

  const unseatedSeats = visible.filter((g) => !g.table_id).reduce((n, g) => n + seatsFor(g), 0);

  return (
    <div
      className={cn("card flex flex-col min-h-0", dropHover && "ring-2 ring-moss-400")}
      onDragOver={(e) => { if (canSeat && e.dataTransfer.types.includes(GUEST_DRAG)) { e.preventDefault(); setDropHover(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropHover(false); }}
      onDrop={(e) => {
        setDropHover(false);
        const raw = e.dataTransfer.getData(GUEST_DRAG);
        if (!raw) return;
        e.preventDefault();
        const ids = (JSON.parse(raw) as string[]).filter((id) => guests.find((g) => g.id === id)?.table_id);
        if (ids.length) onUnseat(ids);
      }}
    >
      <div className="p-3 border-b border-paper-line space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-serif text-base text-ink">Guests</h3>
          <span className="text-xs text-ink-faint">{unseatedSeats} seat{unseatedSeats === 1 ? "" : "s"} to place</span>
        </div>
        <input className="input py-1.5 text-sm" placeholder="Search name or household" value={search} onChange={(e) => changeFilter(() => setSearch(e.target.value))} />
        <div className="flex gap-2">
          <select className="input py-1.5 text-sm" value={status} onChange={(e) => changeFilter(() => setStatus(e.target.value as StatusFilter))} aria-label="RSVP status">
            <option value="attending">Attending</option>
            <option value="attending_maybe">Attending + Maybe</option>
            <option value="all">Everyone</option>
          </select>
          {clones.length > 1 && (
            <select className="input py-1.5 text-sm" value={clone} onChange={(e) => changeFilter(() => setClone(e.target.value))} aria-label="Clone">
              <option value="">All clones</option>
              {clones.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="none">Unassigned</option>
            </select>
          )}
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-soft">
          <input type="checkbox" className="accent-wine-500" checked={showSeated} onChange={(e) => changeFilter(() => setShowSeated(e.target.checked))} />
          Include guests who already have a table
        </label>
        {canSeat && selected.size > 0 && (
          <div className="flex items-center justify-between rounded bg-moss-50 px-2.5 py-1.5 text-xs text-moss-600">
            <span>{selected.size} selected — click a table to seat them</span>
            <button className="font-medium hover:underline" onClick={() => onSelect(new Set())}>Clear</button>
          </div>
        )}
      </div>

      <div className="overflow-y-auto min-h-0 flex-1 p-2">
        {visible.length === 0 && (
          <p className="p-3 text-sm text-ink-faint">
            {guests.length === 0 ? "No guests yet." : showSeated ? "Nobody matches these filters." : "Everyone here has a table. 🎉"}
          </p>
        )}
        {units.groups.map(([gid, u]) => {
          const ids = u.members.map((m) => m.id);
          const allOn = ids.every((id) => selected.has(id));
          return (
            <div key={gid} className="mb-1.5 rounded border border-paper-line">
              <div
                draggable={canSeat}
                onDragStart={(e) => dragStart(e, ids)}
                className={cn("flex items-center gap-2 px-2 py-1.5 bg-paper-soft rounded-t text-xs", canSeat && "cursor-grab")}
              >
                {canSeat && <input type="checkbox" aria-label={`Select ${u.name}`} className="accent-wine-500" checked={allOn} onChange={(e) => toggle(ids, e.target.checked)} />}
                <span className="font-medium text-ink truncate">{u.name}</span>
                <span className="ml-auto text-ink-faint shrink-0">household · {u.members.reduce((n, m) => n + seatsFor(m), 0)}</span>
              </div>
              {u.members.map((g) => <GuestRow key={g.id} g={g} {...{ canSeat, selected, toggle, dragStart, pendingIds, tableLabel }} />)}
            </div>
          );
        })}
        {units.singles.map((g) => <GuestRow key={g.id} g={g} {...{ canSeat, selected, toggle, dragStart, pendingIds, tableLabel }} />)}
      </div>
      {canSeat && <p className="px-3 py-2 border-t border-paper-line text-[11px] text-ink-faint">Drag onto a table, or drop a seated guest here to unseat.</p>}
    </div>
  );
}

function GuestRow({ g, canSeat, selected, toggle, dragStart, pendingIds, tableLabel }: {
  g: SeatingGuest; canSeat: boolean; selected: Set<string>; toggle: (ids: string[], on: boolean) => void;
  dragStart: (e: React.DragEvent, ids: string[]) => void; pendingIds: Set<string>; tableLabel: (id: string) => string;
}) {
  const seats = seatsFor(g);
  return (
    <label
      draggable={canSeat}
      onDragStart={(e) => dragStart(e, [g.id])}
      className={cn("flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-paper-soft", canSeat && "cursor-grab", selected.has(g.id) && "bg-wine-50")}
    >
      {canSeat && <input type="checkbox" className="accent-wine-500" checked={selected.has(g.id)} onChange={(e) => toggle([g.id], e.target.checked)} />}
      <span className="truncate text-ink">{fullName(g.first_name, g.last_name)}</span>
      {seats > 1 && <span className="chip bg-ink/5 text-ink-soft" title={`Party of ${seats}`}>+{seats - 1}</span>}
      {g.rsvp_status !== "attending" && <span className="chip bg-brass-50 text-brass-600">{STATUS_LABEL[g.rsvp_status || ""] || "No response"}</span>}
      <span className="ml-auto shrink-0 text-xs text-ink-faint">
        {pendingIds.has(g.id) && <span title="Change awaiting approval" className="text-brass-600 mr-1">⏳</span>}
        {g.table_id ? tableLabel(g.table_id) : ""}
      </span>
    </label>
  );
}
