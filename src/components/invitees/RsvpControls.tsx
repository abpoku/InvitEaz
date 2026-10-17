"use client";

import { cn, formatDateTime, formatNumber } from "@/lib/utils";

// The RSVP pieces of the Invitees tab (status picker, party size, group breakdown) — shared by its
// desktop table and phone cards. A planner's pick records a real response row (recordManualResponse),
// exactly like the Responses tab these came from.

export const STATUSES = ["attending", "maybe", "declined"] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = { attending: "Attending", maybe: "Maybe", declined: "Declined" };
const STATUS_ACTIVE_CLASSES: Record<Status, string> = {
  attending: "bg-moss-50 text-moss-600",
  maybe: "bg-wine-500/10 text-wine-600",
  declined: "bg-clay-500/10 text-clay-600",
};

/** Attending / Maybe / Declined as one segmented control. `current` highlights the recorded status;
 * the group-level control passes none, since it sets every member at once. `large` is the phone
 * card size: full width, 44px tall. */
export function StatusSegments({ current, disabled, onPick, large }: {
  current?: Status | null;
  disabled: boolean;
  onPick: (s: Status) => void;
  large?: boolean;
}) {
  return (
    <div className={cn("rounded border border-paper-line overflow-hidden", large ? "grid grid-cols-3 divide-x divide-paper-line text-sm" : "inline-flex text-xs")}>
      {STATUSES.map((s) => (
        <button
          key={s}
          type="button"
          disabled={disabled}
          onClick={() => onPick(s)}
          aria-pressed={current === undefined ? undefined : current === s}
          className={cn(
            large ? "py-2.5" : "px-2 py-1",
            "disabled:opacity-50",
            current === s ? STATUS_ACTIVE_CLASSES[s] : "text-ink-faint hover:bg-paper-soft"
          )}
        >
          {STATUS_LABEL[s]}
        </button>
      ))}
    </div>
  );
}

/** Under the picker while someone hasn't replied: whether they've at least opened their link. */
export function NoReplyNote({ invitationStatus }: { invitationStatus: string | null }) {
  return <span className="block mt-1 text-xs text-ink-faint">{invitationStatus === "opened" ? "Opened their link, no reply yet" : "No reply yet"}</span>;
}

export type BreakdownCounts = Record<Status | "no_response", number>;

export function breakdownOf(members: { rsvp_status: Status | null }[]): BreakdownCounts {
  const counts: BreakdownCounts = { attending: 0, maybe: 0, declined: 0, no_response: 0 };
  for (const m of members) counts[m.rsvp_status || "no_response"]++;
  return counts;
}

export function Breakdown({ counts }: { counts: BreakdownCounts }) {
  return (
    <>
      <span className="text-moss-600">{formatNumber(counts.attending)} attending</span> · {formatNumber(counts.maybe)} maybe · <span className="text-wine-700">{formatNumber(counts.declined)} declined</span> · {formatNumber(counts.no_response)} no response
    </>
  );
}

/** Party size for an attending row, saved when the field loses focus — only when the number actually
 * changed, since every save records a new response row. `large` adds the label (phone cards). */
export function PartySize({ value, onSave, large }: { value: number | null; onSave: (n: number) => void; large?: boolean }) {
  const input = (
    <input
      type="number" min={1} inputMode="numeric"
      aria-label={large ? undefined : "Party size"}
      className={large ? "input w-20 py-1.5 text-base" : "input w-16 py-1 text-base sm:text-xs"}
      defaultValue={value ?? 1}
      onBlur={(e) => { const n = Number(e.target.value) || 1; if (n !== (value ?? 1)) onSave(n); }}
    />
  );
  if (!large) return input;
  return <label className="mt-2 flex items-center gap-2 text-sm text-ink-soft">Party size{input}</label>;
}

/** "<when> (edited) · marked by <planner>", or null before any response. */
export function respondedText(r: { responded_at: string | null; is_modification: number | null; recorded_by: string | null }): string | null {
  if (!r.responded_at) return null;
  return `${formatDateTime(r.responded_at)}${r.is_modification ? " (edited)" : ""}${r.recorded_by ? ` · marked by ${r.recorded_by}` : ""}`;
}
