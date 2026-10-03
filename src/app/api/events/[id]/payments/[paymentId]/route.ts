import { NextResponse } from "next/server";
import { requireAssemblyScope } from "@/lib/session";
import { canManageInvitee, canManageGroup } from "@/lib/models/invitees";
import { getPayment, updatePayment, voidPayment, listAllocations } from "@/lib/models/ticketing";
import { validatePaymentDetails } from "@/lib/payment-methods";
import { logAudit } from "@/lib/models/events";

async function canManagePayment(paymentId: string, eventId: string, assemblyId: string | null): Promise<boolean> {
  const payment = await getPayment(paymentId);
  if (!payment || payment.event_id !== eventId) return false;
  if (payment.invitee_id) return canManageInvitee(payment.invitee_id, eventId, assemblyId);
  return canManageGroup(payment.group_id!, eventId, assemblyId);
}

export async function PATCH(req: Request, { params }: { params: { id: string; paymentId: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  if (access.role === "viewer") return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });
  if (!(await canManagePayment(params.paymentId, params.id, access.assemblyId))) {
    return NextResponse.json({ error: "Payment not found." }, { status: 404 });
  }

  let body: any = {};
  try { body = await req.json(); } catch {}
  const existing = (await getPayment(params.paymentId))!;
  if (existing.voided_at) return NextResponse.json({ error: "A voided payment can't be edited." }, { status: 400 });
  const invalid = validatePaymentDetails(body, true);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const patch: Parameters<typeof updatePayment>[1] = {};
  if (body.amountCents !== undefined) {
    if (!Number.isInteger(body.amountCents) || body.amountCents <= 0) return NextResponse.json({ error: "Amount must be a positive whole number of cents." }, { status: 400 });
    // A custom split can never claim more than the payment itself.
    const allocated = (await listAllocations(params.paymentId)).reduce((sum, a) => sum + a.amount_cents, 0);
    if (body.amountCents < allocated) {
      return NextResponse.json({ error: "This payment is split among members for more than that amount — adjust the split first." }, { status: 400 });
    }
    patch.amountCents = body.amountCents;
  }
  if (body.note !== undefined) patch.note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;
  if (body.paidOn !== undefined) patch.paidOn = body.paidOn;
  if (body.method !== undefined) {
    patch.method = body.method;
    patch.methodOther = typeof body.methodOther === "string" ? body.methodOther.trim() : null;
  }

  await updatePayment(params.paymentId, patch);
  await logAudit(
    params.id, access.user.email, "payments.edited",
    `${params.paymentId}: ${Object.keys(patch).join(", ")}${patch.amountCents !== undefined ? ` (${existing.amount_cents} -> ${patch.amountCents} cents)` : ""}`
  );

  return NextResponse.json({ payment: await getPayment(params.paymentId) });
}

export async function DELETE(_req: Request, { params }: { params: { id: string; paymentId: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  if (access.role === "viewer") return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });
  if (!(await canManagePayment(params.paymentId, params.id, access.assemblyId))) {
    return NextResponse.json({ error: "Payment not found." }, { status: 404 });
  }

  await voidPayment(params.paymentId, access.user.email);
  await logAudit(params.id, access.user.email, "payments.voided", params.paymentId);

  return NextResponse.json({ ok: true });
}
