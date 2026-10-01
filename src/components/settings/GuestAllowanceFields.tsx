"use client";

import { MAX_GUEST_ALLOWANCE, describeGuestAllowance, type GuestAllowanceMode } from "@/lib/guest-allowance";

/** The event's explicit additional-guest allowance — used by both the create-event page and
 * Settings. Value/onChange only; the caller owns the state and how it's saved. */
export function GuestAllowanceFields({
  mode, count, onChange,
}: {
  mode: GuestAllowanceMode;
  count: number;
  onChange: (mode: GuestAllowanceMode, count: number) => void;
}) {
  return (
    <div>
      <label className="label">Additional guests</label>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
        <select className="input" value={mode} onChange={(e) => onChange(e.target.value as GuestAllowanceMode, Math.max(1, count))}>
          <option value="none">No additional guests</option>
          <option value="per_person">Allowed per invited person</option>
          <option value="per_group">Allowed per group / household</option>
        </select>
        {mode !== "none" && (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={MAX_GUEST_ALLOWANCE}
              className="input w-20"
              aria-label="Number of additional guests"
              value={count}
              onChange={(e) => onChange(mode, Math.min(MAX_GUEST_ALLOWANCE, Math.max(1, Number(e.target.value) || 1)))}
            />
            <span className="text-sm text-ink-soft whitespace-nowrap">guest{count === 1 ? "" : "s"}</span>
          </div>
        )}
      </div>
      <p className="mt-1 text-xs text-ink-faint">
        {describeGuestAllowance({ mode, count })}.{" "}
        {mode === "per_group"
          ? "Groups can add this many guests from their group RSVP link."
          : mode === "per_person"
            ? "You can still override this for individual invitees."
            : "Guests can't add anyone to their RSVP."}
      </p>
    </div>
  );
}
