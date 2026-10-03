import { NextResponse } from "next/server";
import { requireAssemblyScope } from "@/lib/session";
import { canManageGroup, groupMembers } from "@/lib/models/invitees";
import { getPayment, replaceAllocations } from "@/lib/models/ticketing";
import { logAudit } from "@/lib/models/events";

/** Replaces a group payment's custom split: `{ allocations: [{ inviteeId, amountCents }] }`. An empty
 * list removes the split (the whole payment goes back to being shared equally). Scope is derived
 * from the payment's own stored group, never from the request body. */
export async function PUT(req: Request, { params }: { params: { id: string; paymentId: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  if (access.role === "viewer") return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });

  const payment = await getPayment(params.paymentId);
  if (!payment || payment.event_id !== params.id || !payment.group_id || !(await canManageGroup(payment.group_id, params.id, access.assemblyId))) {
    return NextResponse.json({ error: "Group payment not found." }, { status: 404 });
  }
  if (payment.voided_at) return NextResponse.json({ error: "A voided payment can't be split." }, { status: 400 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const raw: any[] = Array.isArray(body.allocations) ? body.allocations : [];
  const memberIds = new Set((await groupMembers(payment.group_id)).map((m) => m.id));

  const seen = new Set<string>();
  const allocations: { inviteeId: string; amountCents: number }[] = [];
  for (const a of raw) {
    if (!a || typeof a.inviteeId !== "string" || !memberIds.has(a.inviteeId)) {
      return NextResponse.json({ error: "A payment can only be split among the group's current members." }, { status: 400 });
    }
    if (seen.has(a.inviteeId)) return NextResponse.json({ error: "Each member can appear only once in a split." }, { status: 400 });
    seen.add(a.inviteeId);
    if (!Number.isInteger(a.amountCents) || a.amountCents < 0) {
      return NextResponse.json({ error: "Split amounts must be whole cents, zero or more." }, { status: 400 });
    }
    if (a.amountCents > 0) allocations.push({ inviteeId: a.inviteeId, amountCents: a.amountCents });
  }
  const total = allocations.reduce((sum, a) => sum + a.amountCents, 0);
  if (total > payment.amount_cents) {
    return NextResponse.json({ error: "The split adds up to more than the payment." }, { status: 400 });
  }

  await replaceAllocations(payment.id, allocations);
  await logAudit(
    params.id, access.user.email, "payments.split",
    `${payment.id}: ${allocations.map((a) => `${a.inviteeId}=${a.amountCents}`).join(", ") || "cleared"} (of ${payment.amount_cents} cents)`
  );
  return NextResponse.json({ ok: true });
}
