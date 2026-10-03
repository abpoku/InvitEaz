import { NextResponse } from "next/server";
import { requireAssemblyScope } from "@/lib/session";
import { canManageInvitee } from "@/lib/models/invitees";
import { getTicketingConfig, setTicketTiers } from "@/lib/models/ticketing";
import { logAudit } from "@/lib/models/events";

/** Changes ticket tiers from the Tickets tab: `{ assignments: [{ inviteeId, tier }] }`, where tier is
 * a configured tier name or "" to clear. Same day-to-day scope as payments (assembly-scoped,
 * viewers blocked) — unlike tier *pricing*, which stays full-event admin on Overview. All-or-nothing:
 * one unknown tier or out-of-scope invitee rejects the whole request. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  if (access.role === "viewer") return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });

  const config = await getTicketingConfig(params.id);
  if (!config.enabled || !config.field) return NextResponse.json({ error: "Ticketing isn't set up for this event." }, { status: 400 });
  const tierNames = new Set(config.tiers.map((t) => t.option_value));

  let body: any = {};
  try { body = await req.json(); } catch {}
  const raw: any[] = Array.isArray(body.assignments) ? body.assignments : [];
  if (raw.length === 0) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  const assignments: { inviteeId: string; tier: string }[] = [];
  for (const a of raw) {
    const tier = typeof a?.tier === "string" ? a.tier : "";
    if (tier && !tierNames.has(tier)) return NextResponse.json({ error: `"${tier}" isn't one of this event's ticket types.` }, { status: 400 });
    if (typeof a?.inviteeId !== "string" || !(await canManageInvitee(a.inviteeId, params.id, access.assemblyId))) {
      return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });
    }
    assignments.push({ inviteeId: a.inviteeId, tier });
  }

  await setTicketTiers(params.id, assignments);
  await logAudit(params.id, access.user.email, "ticketing.tier_assigned", assignments.map((a) => `${a.inviteeId}=${a.tier || "(none)"}`).join(", "));
  return NextResponse.json({ ok: true });
}
