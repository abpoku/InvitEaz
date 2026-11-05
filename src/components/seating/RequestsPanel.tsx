"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import type { SeatingRequest } from "./types";

/** Clone planners' moves/unseats waiting on the owner. The owner approves or rejects (one or all);
 * the planners who asked can withdraw; admins just see what's waiting. */
export function RequestsPanel({ requests, canApprove, isScoped, tableLabel, onDecide, onDecideAll }: {
  requests: SeatingRequest[];
  canApprove: boolean;
  isScoped: boolean;
  tableLabel: (id: string | null) => string;
  onDecide: (id: string, action: "approve" | "reject" | "withdraw") => Promise<void>;
  onDecideAll: (action: "approve_all" | "reject_all") => Promise<void>;
}) {
  const [open, setOpen] = useState(canApprove);
  const [busy, setBusy] = useState<string | null>(null);
  if (requests.length === 0) return null;

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try { await fn(); } finally { setBusy(null); }
  }

  const n = requests.length;
  const changes = `${n} seating change${n === 1 ? "" : "s"}`;
  const title = canApprove
    ? `${changes} awaiting your approval`
    : isScoped
      ? `${changes} you asked for ${n === 1 ? "is" : "are"} awaiting the owner's approval`
      : `${changes} from clone planners ${n === 1 ? "is" : "are"} awaiting the owner's approval`;

  return (
    <div className="rounded-lg border border-brass-200 bg-brass-50">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left text-sm text-brass-600" aria-expanded={open}>
        <span className="font-medium">⏳ {title}</span>
        <span className="text-xs">{open ? "Hide" : "Review"}</span>
      </button>
      {open && (
        <div className="border-t border-brass-200 px-4 py-3 space-y-2">
          {canApprove && requests.length > 1 && (
            <div className="flex gap-2 justify-end">
              <button disabled={!!busy} className="btn-ghost py-1 px-2.5 text-xs" onClick={() => run("all-r", () => onDecideAll("reject_all"))}>Reject all</button>
              <button disabled={!!busy} className="btn-primary py-1 px-2.5 text-xs" onClick={() => run("all-a", () => onDecideAll("approve_all"))}>
                {busy === "all-a" ? "Approving…" : "Approve all"}
              </button>
            </div>
          )}
          <ul className="divide-y divide-brass-200">
            {requests.map((r) => (
              <li key={r.id} className="py-2 flex items-center gap-3 flex-wrap text-sm">
                <div className="min-w-0 flex-1">
                  <p className="text-ink">
                    <span className="font-medium">{r.invitee_name}</span>: {tableLabel(r.from_table_id)} → {r.to_table_id ? tableLabel(r.to_table_id) : <em>no table</em>}
                  </p>
                  <p className="text-xs text-ink-faint">{r.requested_by} · {formatDistanceToNow(new Date(r.requested_at), { addSuffix: true })}</p>
                </div>
                {canApprove ? (
                  <div className="flex gap-1.5 shrink-0">
                    <button disabled={!!busy} className="btn-ghost py-1 px-2.5 text-xs" onClick={() => run(r.id, () => onDecide(r.id, "reject"))}>Reject</button>
                    <button disabled={!!busy} className="btn-secondary py-1 px-2.5 text-xs" onClick={() => run(r.id, () => onDecide(r.id, "approve"))}>Approve</button>
                  </div>
                ) : isScoped ? (
                  <button disabled={!!busy} className="btn-ghost py-1 px-2.5 text-xs shrink-0" onClick={() => run(r.id, () => onDecide(r.id, "withdraw"))}>Withdraw</button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
