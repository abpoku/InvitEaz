import { NextResponse } from "next/server";
import { requireAssemblyScope } from "@/lib/session";
import { canManageInvitee, canManageGroup } from "@/lib/models/invitees";
import { getPayment, updatePayment, voidPayment } from "@/lib/models/ticketing";
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

  const body = await req.json();
  const patch: { amountCents?: number; note?: string } = {};
  if (body.amountCents !== undefined) {
    if (!Number.isInteger(body.amountCents) || body.amountCents <= 0) return NextResponse.json({ error: "Amount must be a positive whole number of cents." }, { status: 400 });
    patch.amountCents = body.amountCents;
  }
  if (body.note !== undefined) patch.note = body.note;

  await updatePayment(params.paymentId, patch);
  await logAudit(params.id, access.user.email, "payments.edited", params.paymentId);

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
