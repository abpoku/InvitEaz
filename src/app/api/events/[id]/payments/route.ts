import { NextResponse } from "next/server";
import { requireAssemblyScope } from "@/lib/session";
import { canManageInvitee, canManageGroup } from "@/lib/models/invitees";
import { createPayment, listPaymentsWithAllocations, getTicketingConfig, refundableFor } from "@/lib/models/ticketing";
import { logAudit } from "@/lib/models/events";
import { validatePaymentDetails } from "@/lib/payment-methods";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  if (access.role === "viewer") return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const { targetType, targetId, note } = body;
  const amountCents = body.amountCents;
  if (!Number.isInteger(amountCents) || amountCents <= 0) return NextResponse.json({ error: "Amount must be a positive whole number of cents." }, { status: 400 });
  if (targetType !== "invitee" && targetType !== "group") return NextResponse.json({ error: "Invalid target." }, { status: 400 });
  if (!targetId) return NextResponse.json({ error: "Missing target." }, { status: 400 });
  const invalid = validatePaymentDetails(body, false);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const allowed = targetType === "invitee"
    ? await canManageInvitee(targetId, params.id, access.assemblyId)
    : await canManageGroup(targetId, params.id, access.assemblyId);
  if (!allowed) return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });

  // kind = "refund": money handed back from one bucket, capped at what this target has in it.
  // kind = "payment" (default): donationCents of it (0..amount) goes to the donations bucket.
  const kind = body.kind === "refund" ? "refund" : "payment";
  let donationCents = 0;
  const { donations } = await getTicketingConfig(params.id);
  if (kind === "refund") {
    if (body.bucket !== "ticket" && body.bucket !== "donation") return NextResponse.json({ error: "Choose what this refund comes out of." }, { status: 400 });
    const available = await refundableFor(targetType === "invitee" ? { inviteeId: targetId } : { groupId: targetId });
    const cap = body.bucket === "donation" ? available.donationCents : available.ticketCents;
    if (amountCents > cap) {
      return NextResponse.json({ error: `You can refund at most $${(cap / 100).toFixed(2)} from ${body.bucket === "donation" ? donations.label : "ticket payments"} here.` }, { status: 400 });
    }
    donationCents = body.bucket === "donation" ? amountCents : 0;
  } else if (body.donationCents !== undefined && body.donationCents !== 0) {
    if (!Number.isInteger(body.donationCents) || body.donationCents < 0 || body.donationCents > amountCents) {
      return NextResponse.json({ error: "The donation portion must be between $0 and the payment amount." }, { status: 400 });
    }
    if (!donations.enabled) return NextResponse.json({ error: `${donations.label} isn't turned on for this event.` }, { status: 400 });
    donationCents = body.donationCents;
  }

  const payment = await createPayment({
    eventId: params.id,
    inviteeId: targetType === "invitee" ? targetId : undefined,
    groupId: targetType === "group" ? targetId : undefined,
    amountCents,
    paidOn: body.paidOn,
    method: body.method,
    methodOther: typeof body.methodOther === "string" ? body.methodOther.trim() : undefined,
    note: typeof note === "string" && note.trim() ? note.trim() : undefined,
    recordedBy: access.user.email,
    kind,
    donationCents,
  });
  await logAudit(
    params.id, access.user.email, kind === "refund" ? "payments.refunded" : "payments.recorded",
    `${amountCents} cents${donationCents ? ` (${donationCents} to donations)` : ""} (${body.method}, ${body.paidOn}) ${kind === "refund" ? `refunded from ${body.bucket} to` : "recorded for"} ${targetType} ${targetId}`
  );

  return NextResponse.json({ payment });
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });

  const url = new URL(req.url);
  const inviteeId = url.searchParams.get("inviteeId");
  const groupId = url.searchParams.get("groupId");
  const includeVoided = url.searchParams.get("includeVoided") === "1";

  if (!!inviteeId === !!groupId) return NextResponse.json({ error: "Pass exactly one of inviteeId or groupId." }, { status: 400 });

  if (inviteeId) {
    if (!(await canManageInvitee(inviteeId, params.id, access.assemblyId))) return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });
    const [payments, refundable] = await Promise.all([listPaymentsWithAllocations({ inviteeId }, includeVoided), refundableFor({ inviteeId })]);
    return NextResponse.json({ payments, refundable });
  }
  if (!(await canManageGroup(groupId!, params.id, access.assemblyId))) return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });
  const [payments, refundable] = await Promise.all([listPaymentsWithAllocations({ groupId: groupId! }, includeVoided), refundableFor({ groupId: groupId! })]);
  return NextResponse.json({ payments, refundable });
}
