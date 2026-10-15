"use client";

import { useSearchParams } from "next/navigation";
import { formatNumber } from "@/lib/utils";

export interface HeaderStats {
  invited: number;
  attending: number;
  maybe: number;
  declined: number;
  noResponse: number;
  responseRate: number;
}

/** The event header's headline numbers. They follow the page's clone filter — the `?clone=` in the URL,
 * which Responses and Tickets set and Invitees mirrors — when that names one of `byClone` (each clone
 * plus "unassigned", computed by the layout); otherwise they're the whole event's. A clone-scoped
 * planner gets no `byClone` — their `stats` are already just their clone. */
export function EventHeaderStats({ stats, byClone }: { stats: HeaderStats; byClone?: Record<string, { name: string; stats: HeaderStats }> }) {
  const clone = useSearchParams().get("clone");
  const selected = clone && byClone ? byClone[clone] : undefined;
  const s = selected?.stats ?? stats;
  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
      {selected && <span className="chip bg-wine-500/10 text-wine-600">{selected.name}</span>}
      <MiniStat label="Invited" value={s.invited} />
      <MiniStat label="Attending" value={s.attending} tone="text-moss-600" />
      <MiniStat label="Maybe" value={s.maybe} />
      <MiniStat label="Declined" value={s.declined} tone="text-wine-700" />
      <MiniStat label="No response" value={s.noResponse} />
      <MiniStat label="Response rate" value={`${s.responseRate}%`} />
    </div>
  );
}

function MiniStat({ label, value, tone = "text-ink" }: { label: string; value: string | number; tone?: string }) {
  return (
    <div>
      <span className={`font-serif text-lg ${tone}`}>{typeof value === "number" ? formatNumber(value) : value}</span>
      <span className="ml-1.5 text-ink-faint">{label}</span>
    </div>
  );
}
