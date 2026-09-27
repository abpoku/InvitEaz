import { NextResponse } from "next/server";
import { requireEventRole } from "@/lib/session";
import { deleteTicketTier } from "@/lib/models/ticketing";
import { logAudit } from "@/lib/models/events";

export async function DELETE(_req: Request, { params }: { params: { id: string; tierId: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });

  await deleteTicketTier(params.tierId);
  await logAudit(params.id, access.user.email, "ticketing.tier_deleted", params.tierId);

  return NextResponse.json({ ok: true });
}
