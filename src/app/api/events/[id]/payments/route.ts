import { NextResponse } from "next/server";
import { requireAssemblyScope } from "@/lib/session";
import { canManageInvitee, canManageGroup } from "@/lib/models/invitees";
import { createPayment, listPaymentsWithAllocations } from "@/lib/models/ticketing";
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
  });
  await logAudit(params.id, access.user.email, "payments.recorded", `${amountCents} cents (${body.method}, ${body.paidOn}) recorded for ${targetType} ${targetId}`);

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
    return NextResponse.json({ payments: await listPaymentsWithAllocations({ inviteeId }, includeVoided) });
  }
  if (!(await canManageGroup(groupId!, params.id, access.assemblyId))) return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });
  return NextResponse.json({ payments: await listPaymentsWithAllocations({ groupId: groupId! }, includeVoided) });
}
