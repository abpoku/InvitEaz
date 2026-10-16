import { NextResponse } from "next/server";
import { requireEventRole } from "@/lib/session";
import { getCapsOverview, replaceCaps, capKey } from "@/lib/models/ticket-caps";
import { logAudit } from "@/lib/models/events";
import type { TicketCap } from "@/lib/ticket-caps";

/** Ticket limits for the Overview tab's Ticketing card: the limits plus how many tickets are taken in
 * every whole-event / clone × all-types / type cell. Full-event roles only, like the rest of that card. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const access = await requireEventRole(params.id, "viewer");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  return NextResponse.json(await getCapsOverview(params.id));
}

/** Replaces all limits. Body: { caps: [{ assemblyId: string|null, tier: string|null, cap: number }] };
 * a cell left out has no limit. */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const raw: any[] = Array.isArray(body.caps) ? body.caps : [];
  const { tiers, clones } = await getCapsOverview(params.id);
  const cloneIds = new Set(clones.map((c) => c.id));

  const caps: TicketCap[] = [];
  const seen = new Set<string>();
  for (const c of raw) {
    const assemblyId = c?.assemblyId ?? null;
    const tier = c?.tier ?? null;
    if (assemblyId !== null && !cloneIds.has(assemblyId)) return NextResponse.json({ error: "Clone not found." }, { status: 400 });
    if (tier !== null && !tiers.includes(tier)) return NextResponse.json({ error: `"${tier}" isn't one of this event's ticket types.` }, { status: 400 });
    if (!Number.isInteger(c?.cap) || c.cap < 0 || c.cap > 1_000_000) {
      return NextResponse.json({ error: "Each limit must be a whole number, 0 or more." }, { status: 400 });
    }
    const key = capKey(assemblyId, tier);
    if (seen.has(key)) return NextResponse.json({ error: "The same limit was given twice." }, { status: 400 });
    seen.add(key);
    caps.push({ assemblyId, tier, cap: c.cap });
  }

  await replaceCaps(params.id, caps);
  await logAudit(params.id, access.user.email, "ticketing.caps_updated", `${caps.length} limit${caps.length === 1 ? "" : "s"} set`);
  return NextResponse.json(await getCapsOverview(params.id));
}
