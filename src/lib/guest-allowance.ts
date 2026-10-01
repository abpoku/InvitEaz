// Pure, client-safe (no db imports): shared by the settings UI, both RSVP pages, and the group
// RSVP API, so the planner-facing description and the server-enforced limit can never disagree.

export type GuestAllowanceMode = "none" | "per_person" | "per_group";
export type PlusOnePolicy = "none" | "one" | "multiple";

export interface GuestAllowance {
  mode: GuestAllowanceMode;
  /** Additional guests allowed — per invited person, or per group, depending on `mode`. */
  count: number;
}

export const MAX_GUEST_ALLOWANCE = 20;
// What the legacy "May bring multiple" policy always meant in practice: a party of up to 8.
const LEGACY_MULTIPLE = 7;

type EventLike = {
  guest_allowance_mode?: string | null;
  guest_allowance_count?: number | null;
  default_plus_one_policy?: string | null;
};

export function eventGuestAllowance(event: EventLike): GuestAllowance {
  const mode = event.guest_allowance_mode;
  if (mode === "per_person" || mode === "per_group") {
    return { mode, count: clampCount(event.guest_allowance_count) };
  }
  if (mode === "none") return { mode: "none", count: 0 };
  // Not set yet (schema.sql backfills this, but never trust a single source) — derive from legacy.
  if (event.default_plus_one_policy === "one") return { mode: "per_person", count: 1 };
  if (event.default_plus_one_policy === "multiple") return { mode: "per_person", count: LEGACY_MULTIPLE };
  return { mode: "none", count: 0 };
}

export function clampCount(n: unknown): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 1) return 1;
  return Math.min(v, MAX_GUEST_ALLOWANCE);
}

/** Keeps the legacy column meaningful for anything that still reads it. */
export function legacyPolicyFor(a: GuestAllowance): PlusOnePolicy {
  if (a.mode === "none") return "none";
  return a.count === 1 ? "one" : "multiple";
}

/** Additional guests one invited person may bring, honoring their per-invitee override
 * (invitees.plus_one_policy) when the planner set one. */
export function personExtraGuests(event: EventLike, override: string | null | undefined): number {
  const a = eventGuestAllowance(event);
  if (override === "none") return 0;
  if (override === "one") return 1;
  if (override === "multiple") return a.mode === "none" ? LEGACY_MULTIPLE : Math.max(2, a.count);
  return a.mode === "none" ? 0 : a.count;
}

/** Additional guests a whole household may add from its group link. `members` are the planner's
 * own invitees in the group — guests added from the link never earn allowance themselves. */
export function groupExtraGuests(event: EventLike, members: { plus_one_policy: string | null }[]): number {
  const a = eventGuestAllowance(event);
  if (a.mode === "per_group") return a.count;
  return members.reduce((sum, m) => sum + personExtraGuests(event, m.plus_one_policy), 0);
}

export function describeGuestAllowance(a: GuestAllowance): string {
  if (a.mode === "none") return "No additional guests";
  const guests = `${a.count} additional guest${a.count === 1 ? "" : "s"}`;
  return a.mode === "per_person" ? `${guests} per invited person` : `${guests} per group`;
}
