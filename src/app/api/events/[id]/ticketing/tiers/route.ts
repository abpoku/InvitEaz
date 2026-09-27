import { NextResponse } from "next/server";
import { requireEventRole } from "@/lib/session";
import { upsertTicketTier, getTicketingConfig } from "@/lib/models/ticketing";
import { logAudit } from "@/lib/models/events";

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });

  const config = await getTicketingConfig(params.id);
  if (!config.enabled || !config.field) {
    return NextResponse.json({ error: "Ticketing isn't enabled and linked to a field yet." }, { status: 400 });
  }

  const body = await req.json();
  const tiers: { optionValue: string; priceCents: number }[] = Array.isArray(body.tiers) ? body.tiers : [];
  for (const t of tiers) {
    if (typeof t.optionValue !== "string" || !t.optionValue) return NextResponse.json({ error: "Invalid tier." }, { status: 400 });
    if (!Number.isInteger(t.priceCents) || t.priceCents < 0) return NextResponse.json({ error: "Prices must be non-negative whole cents." }, { status: 400 });
  }

  for (const t of tiers) {
    await upsertTicketTier(params.id, config.field.id, t.optionValue, t.priceCents);
  }
  await logAudit(params.id, access.user.email, "ticketing.tiers_updated", `${tiers.length} tier prices saved`);

  return NextResponse.json({ config: await getTicketingConfig(params.id) });
}
