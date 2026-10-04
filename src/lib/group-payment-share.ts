// Pure (no db imports): how a group's shared payments are applied to its members on the Tickets tab.

export interface ShareMember {
  id: string;
  owedCents: number;        // what this member owes in total (0 if declined / no ticket type)
  alreadyPaidCents: number; // their own payments + any custom-split portions credited to them
}

/** Splits `total` across `weights` in proportion, in whole cents, so the parts always add up to
 * exactly `total` (largest-remainder rounding — no cent is ever lost or invented). */
function proportional(total: number, weights: { id: string; w: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  const sum = weights.reduce((s, x) => s + x.w, 0);
  if (total <= 0 || sum <= 0) return out;
  const parts = weights.map((x) => {
    const exact = (total * x.w) / sum;
    return { id: x.id, floor: Math.floor(exact), frac: exact - Math.floor(exact) };
  });
  let left = total - parts.reduce((s, p) => s + p.floor, 0);
  parts.sort((a, b) => b.frac - a.frac || a.id.localeCompare(b.id));
  for (const p of parts) {
    out[p.id] = p.floor + (left > 0 ? 1 : 0);
    if (left > 0) left -= 1;
  }
  return out;
}

/** Applies a group's shared (non-split) payments only to members who still have an amount due.
 *
 *  1. While the payment covers less than everything owed, each member with a balance gets a share in
 *     proportion to what they still owe — so nobody is pushed into credit while someone else in the
 *     household is still short.
 *  2. Anything beyond every member's balance is spread across the members who owe for a ticket at
 *     all, in proportion to their ticket price.
 *
 *  A member who owes nothing never receives any of it. If nobody in the group owes anything, nothing
 *  is attributed to individuals — the money still counts on the group's own row. */
export function distributeGroupPayment(poolCents: number, members: ShareMember[]): Record<string, number> {
  if (poolCents <= 0) return {};
  const due = members.map((m) => ({ id: m.id, w: Math.max(0, m.owedCents - m.alreadyPaidCents) }));
  const totalDue = due.reduce((s, d) => s + d.w, 0);
  if (poolCents <= totalDue) return proportional(poolCents, due);

  const out: Record<string, number> = {};
  for (const d of due) if (d.w > 0) out[d.id] = d.w;
  const extra = proportional(poolCents - totalDue, members.filter((m) => m.owedCents > 0).map((m) => ({ id: m.id, w: m.owedCents })));
  for (const [id, c] of Object.entries(extra)) out[id] = (out[id] || 0) + c;
  return out;
}
