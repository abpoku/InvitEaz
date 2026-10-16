"use client";

import { useCallback, useEffect, useState } from "react";
import { formatNumber } from "@/lib/utils";

interface Cap { assemblyId: string | null; tier: string | null; cap: number }
interface Overview { caps: Cap[]; tiers: string[]; clones: { id: string; name: string }[]; used: Record<string, number> }

const key = (assemblyId: string | null, tier: string | null) => `${assemblyId ?? ""}|${tier ?? ""}`;

/** The Ticketing card's "Ticket limits" grid: rows are the whole event and each clone, columns are all
 * ticket types and each type. A blank cell has no limit. Every cell shows how many tickets are taken
 * (attending + holding that type), so a planner sees headroom before choosing a number. Enforcement
 * is server-side, on every path that could take a ticket (models/ticket-caps.ts). */
export function TicketLimits({ eventId, canManage, tierNames }: { eventId: string; canManage: boolean; tierNames: string[] }) {
  const [data, setData] = useState<Overview | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const apply = (o: Overview) => {
    setData(o);
    setValues(Object.fromEntries(o.caps.map((c) => [key(c.assemblyId, c.tier), String(c.cap)])));
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${eventId}/ticketing/caps`);
      let d: any = {};
      try { d = await res.json(); } catch {}
      if (!res.ok) return setError(d.error || "We couldn't load ticket limits.");
      apply(d);
    } catch {
      setError("We couldn't reach the server just now.");
    }
  }, [eventId]);

  // Reload when ticket types are added or removed above, so the columns stay in step.
  const tiersKey = tierNames.join("\u0000");
  useEffect(() => { load(); }, [load, tiersKey]);

  if (tierNames.length === 0) return null;
  if (!data) return <p className="text-sm text-ink-faint">{error || "Loading ticket limits…"}</p>;

  const dirty = (() => {
    const savedMap = Object.fromEntries(data.caps.map((c) => [key(c.assemblyId, c.tier), String(c.cap)]));
    const keys = new Set([...Object.keys(savedMap), ...Object.keys(values)]);
    return [...keys].some((k) => (savedMap[k] ?? "") !== (values[k] ?? "").trim());
  })();

  async function save() {
    setError(null);
    setSaved(false);
    const caps: Cap[] = [];
    for (const [k, raw] of Object.entries(values)) {
      const v = raw.trim();
      if (!v) continue;
      if (!/^\d+$/.test(v)) return setError("Limits must be whole numbers (0 or more), or blank for no limit.");
      const [a, t] = k.split("|");
      caps.push({ assemblyId: a || null, tier: t || null, cap: Number(v) });
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/events/${eventId}/ticketing/caps`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caps }),
      });
      let d: any = {};
      try { d = await res.json(); } catch {}
      if (!res.ok) return setError(d.error || "We couldn't save these limits.");
      apply(d);
      setSaved(true);
    } catch {
      setError("We couldn't reach the server just now.");
    } finally {
      setSaving(false);
    }
  }

  const rows: { id: string | null; name: string }[] = [{ id: null, name: "Whole event" }, ...data.clones];
  const cols: (string | null)[] = [null, ...data.tiers];

  return (
    <div className="pt-4 border-t border-paper-line">
      <h3 className="text-sm font-medium text-ink">Ticket limits</h3>
      <p className="mt-1 text-xs text-ink-faint">
        A ticket is taken when someone is attending and has a ticket type. Leave a box blank for no limit. When a limit is
        reached, guests can&apos;t RSVP yes for that ticket and planners can&apos;t assign more.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr className="text-left text-ink-faint">
              <th className="py-1.5 pr-4 font-medium" />
              {cols.map((t) => <th key={t ?? "all"} className="py-1.5 pr-3 font-medium whitespace-nowrap">{t ?? "All types"}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id ?? "event"} className="border-t border-paper-line align-top">
                <th scope="row" className="py-2 pr-4 text-left font-normal text-ink whitespace-nowrap">{r.name}</th>
                {cols.map((t) => {
                  const k = key(r.id, t);
                  const used = data.used[k] ?? 0;
                  const limit = (values[k] ?? "").trim();
                  const over = limit !== "" && /^\d+$/.test(limit) && used > Number(limit);
                  return (
                      <td key={k} className="py-2 pr-3">
                        <input
                          type="number" min={0} step={1} inputMode="numeric"
                          aria-label={`Limit: ${r.name}, ${t ?? "all types"}`}
                          className="input w-24 py-1 text-sm"
                          placeholder="No limit"
                          disabled={!canManage || saving}
                          value={values[k] ?? ""}
                          onChange={(e) => { setSaved(false); setValues((prev) => ({ ...prev, [k]: e.target.value })); }}
                        />
                        <span className={`mt-0.5 block text-xs ${over ? "text-clay-600" : "text-ink-faint"}`}>
                          {formatNumber(used)} taken{over ? ` · ${formatNumber(used - Number(limit))} over` : ""}
                        </span>
                      </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="mt-2 text-sm text-clay-600">{error}</p>}
      {canManage && (
        <div className="mt-3 flex items-center gap-3">
          <button onClick={save} disabled={!dirty || saving} className="btn-secondary py-1.5 text-sm">{saving ? "Saving…" : "Save limits"}</button>
          {dirty && !saving && <button onClick={() => apply(data)} className="text-sm text-ink-faint hover:text-ink">Undo changes</button>}
          {saved && !dirty && <span className="text-sm text-moss-600">Saved.</span>}
        </div>
      )}
    </div>
  );
}
