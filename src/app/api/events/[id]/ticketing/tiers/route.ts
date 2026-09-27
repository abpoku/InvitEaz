import { NextResponse } from "next/server";
import { requireEventRole } from "@/lib/session";
import { createTier } from "@/lib/models/ticketing";
import { logAudit } from "@/lib/models/events";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });

  const body = await req.json();
  const optionValue = typeof body.optionValue === "string" ? body.optionValue.trim() : "";
  if (!optionValue) return NextResponse.json({ error: "Give this tier a name." }, { status: 400 });
  if (!Number.isInteger(body.priceCents) || body.priceCents < 0) {
    return NextResponse.json({ error: "Price must be a non-negative whole number of cents." }, { status: 400 });
  }

  const config = await createTier(params.id, {
    fieldId: body.fieldId || undefined,
    fieldLabel: body.fieldLabel || undefined,
    optionValue,
    priceCents: body.priceCents,
  });
  await logAudit(params.id, access.user.email, "ticketing.tier_created", `${optionValue} added at ${body.priceCents} cents`);

  return NextResponse.json({ config });
}
