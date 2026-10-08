import { NextResponse } from "next/server";
import { requireAssemblyScope } from "@/lib/session";
import { canManageInvitee, canManageGroup } from "@/lib/models/invitees";
import { getPayment, updatePayment, voidPayment, listAllocations, refundableFor, getTicketingConfig } from "@/lib/models/ticketing";
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
  const invalid = validatePaymentDetails(body, true, existing.method);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const patch: Parameters<typeof updatePayment>[1] = {};
  if (body.amountCents !== undefined && (!Number.isInteger(body.amountCents) || body.amountCents <= 0)) {
    return NextResponse.json({ error: "Amount must be a positive whole number of cents." }, { status: 400 });
  }
  const amount: number = body.amountCents ?? existing.amount_cents;
  const target = existing.invitee_id ? { inviteeId: existing.invitee_id } : { groupId: existing.group_id! };

  if (existing.kind === "refund") {
    // A refund stays in its bucket; its amount just has to fit what's refundable there (counting
    // this refund's own current amount back in, since it's already been subtracted).
    const fromDonations = existing.donation_cents > 0;
    if (body.amountCents !== undefined) {
      const avail = await refundableFor(target);
      const cap = (fromDonations ? avail.donationCents : avail.ticketCents) + existing.amount_cents;
      if (amount > cap) return NextResponse.json({ error: `This refund can be at most $${(cap / 100).toFixed(2)}.` }, { status: 400 });
      patch.amountCents = amount;
      if (fromDonations) patch.donationCents = amount;
    }
  } else {
    let donation = existing.donation_cents;
    if (body.donationCents !== undefined) {
      if (!Number.isInteger(body.donationCents) || body.donationCents < 0) return NextResponse.json({ error: "Invalid donation amount." }, { status: 400 });
      const { donations } = await getTicketingConfig(params.id);
      if (body.donationCents > 0 && !donations.enabled && body.donationCents !== existing.donation_cents) {
        return NextResponse.json({ error: `${donations.label} isn't turned on for this event.` }, { status: 400 });
      }
      donation = body.donationCents;
    }
    if (donation > amount) return NextResponse.json({ error: "The donation portion can't be more than the payment." }, { status: 400 });
    // A custom split can only divide the ticket portion — never more than it.
    const allocated = (await listAllocations(params.paymentId)).reduce((sum, a) => sum + a.amount_cents, 0);
    if (amount - donation < allocated) {
      return NextResponse.json({ error: "This payment is split among members for more than its ticket portion — adjust the split first." }, { status: 400 });
    }
    // Lowering what this payment put into a bucket can't strand a refund already taken from it.
    const avail = await refundableFor(target);
    if (avail.donationCents - (existing.donation_cents - donation) < 0 || avail.ticketCents - ((existing.amount_cents - existing.donation_cents) - (amount - donation)) < 0) {
      return NextResponse.json({ error: "A refund has already been taken from this money — edit or void that refund first." }, { status: 400 });
    }
    if (body.amountCents !== undefined) patch.amountCents = amount;
    if (body.donationCents !== undefined) patch.donationCents = donation;
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

  // Voiding a payment can't leave a refund that was taken out of it hanging (a negative bucket).
  const payment = (await getPayment(params.paymentId))!;
  if (payment.kind === "payment" && !payment.voided_at) {
    const avail = await refundableFor(payment.invitee_id ? { inviteeId: payment.invitee_id } : { groupId: payment.group_id! });
    if (avail.donationCents - payment.donation_cents < 0 || avail.ticketCents - (payment.amount_cents - payment.donation_cents) < 0) {
      return NextResponse.json({ error: "A refund has already been taken from this payment — void that refund first." }, { status: 400 });
    }
  }
  await voidPayment(params.paymentId, access.user.email);
  await logAudit(params.id, access.user.email, "payments.voided", params.paymentId);

  return NextResponse.json({ ok: true });
}
