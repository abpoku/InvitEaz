// Pure, client-safe: ticket limits. A limit applies to the whole event or one clone (assemblyId null =
// whole event), and to all ticket types or one (tier null = all). A ticket is "taken" by an active
// invitee whose latest RSVP is attending and who holds a configured ticket type (Holder). The database
// side — loading holders, applying a change, saving limits — is in models/ticket-caps.ts.

export interface TicketCap { assemblyId: string | null; tier: string | null; cap: number }
export interface Holder { assemblyId: string | null; tier: string }

export function capMatches(cap: Pick<TicketCap, "assemblyId" | "tier">, h: Holder): boolean {
  return (cap.assemblyId === null || cap.assemblyId === h.assemblyId) && (cap.tier === null || cap.tier === h.tier);
}

export function countFor(cap: Pick<TicketCap, "assemblyId" | "tier">, holders: Holder[]): number {
  let n = 0;
  for (const h of holders) if (capMatches(cap, h)) n++;
  return n;
}

export interface CapBreach { cap: TicketCap; before: number; after: number }

/** The first limit a change would break. A change is refused only if it pushes a bucket *further*
 * over its limit — so after a planner lowers a limit below what's already taken, unrelated edits
 * (and anything that frees a ticket) still go through. */
export function findBreach(caps: TicketCap[], before: Holder[], after: Holder[]): CapBreach | null {
  for (const cap of caps) {
    const b = countFor(cap, before);
    const a = countFor(cap, after);
    if (a > cap.cap && a > b) return { cap, before: b, after: a };
  }
  return null;
}

/** "Adult tickets" / "tickets" (singular for 1), plus " for North" for a clone's limit. */
export function capSubject(cap: Pick<TicketCap, "assemblyId" | "tier">, count: number, cloneName?: string | null): string {
  const noun = count === 1 ? "ticket" : "tickets";
  const what = cap.tier ? `${cap.tier} ${noun}` : noun;
  return cap.assemblyId ? `${what} left for ${cloneName || "this clone"}` : `${what} left`;
}

/** Message for a planner: what's full, how many are left, and how to fix it. */
export function plannerBreachMessage(b: CapBreach, cloneName?: string | null): string {
  const left = Math.max(0, b.cap.cap - b.before);
  const need = b.after - b.before;
  const head = left === 0
    ? `No ${capSubject(b.cap, 0, cloneName)} (${b.before} of ${b.cap.cap} taken).`
    : `Only ${left} ${capSubject(b.cap, left, cloneName)}, and this needs ${need}.`;
  return `${head} Raise the limit under Ticket limits on the Overview tab, or free a ticket first.`;
}

/** Message for a guest: no clone names or counts beyond what helps them. */
export function guestBreachMessage(b: CapBreach, group = false): string {
  const kind = b.cap.tier ? `${b.cap.tier} tickets` : "tickets";
  const left = Math.max(0, b.cap.cap - b.before);
  if (group && left > 0) {
    return `Sorry, there aren't enough ${kind} left for everyone marked as attending (${left} left). Please contact the organizer.`;
  }
  return `Sorry, there are no ${kind} left. Please contact the organizer.`;
}
