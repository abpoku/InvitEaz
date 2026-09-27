import { NextResponse } from "next/server";
import { requireEventRole } from "@/lib/session";
import { updateTierPrice, deleteTier, getTicketingConfig } from "@/lib/models/ticketing";
import { logAudit } from "@/lib/models/events";

export async function PATCH(req: Request, { params }: { params: { id: string; tierId: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });

  const body = await req.json();
  if (!Number.isInteger(body.priceCents) || body.priceCents < 0) {
    return NextResponse.json({ error: "Price must be a non-negative whole number of cents." }, { status: 400 });
  }

  await updateTierPrice(params.tierId, body.priceCents);
  await logAudit(params.id, access.user.email, "ticketing.tier_price_updated", `${params.tierId} -> ${body.priceCents} cents`);

  return NextResponse.json({ config: await getTicketingConfig(params.id) });
}

export async function DELETE(_req: Request, { params }: { params: { id: string; tierId: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });

  await deleteTier(params.tierId);
  await logAudit(params.id, access.user.email, "ticketing.tier_deleted", params.tierId);

  return NextResponse.json({ config: await getTicketingConfig(params.id) });
}
