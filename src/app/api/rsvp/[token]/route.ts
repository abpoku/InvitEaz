import { NextResponse } from "next/server";
import { getInvitationByToken, markInvitationOpened, groupMembers } from "@/lib/models/invitees";
import { getEventById, computeEffectiveStatus } from "@/lib/models/events";
import { listQuestions, submitResponse, getLatestResponse, getAnswersForResponse } from "@/lib/models/rsvp";
import { sendConfirmationEmail } from "@/lib/notify";
import { isPastDeadline, fullName } from "@/lib/utils";

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const invitation = await getInvitationByToken(params.token);
  if (!invitation) return NextResponse.json({ error: "This invitation link isn't valid." }, { status: 404 });

  const event = await getEventById(invitation.event_id);
  if (!event) return NextResponse.json({ error: "This event no longer exists." }, { status: 404 });

  await markInvitationOpened(invitation.id);

  const questions = await listQuestions(event.id);
  const latest = await getLatestResponse(invitation.id);
  const answers = latest ? await getAnswersForResponse(latest.id) : [];
  const members = invitation.invitee?.group_id ? await groupMembers(invitation.invitee.group_id) : [];

  const locked = event.status === "cancelled"
    ? false
    : computeEffectiveStatus(event) === "rsvp_closed" || computeEffectiveStatus(event) === "completed";

  return NextResponse.json({
    event: { ...event, effective_status: computeEffectiveStatus(event) },
    invitee: invitation.invitee,
    questions,
    groupMembers: members,
    existingResponse: latest ? { ...latest, answers } : null,
    locked,
  });
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const invitation = await getInvitationByToken(params.token);
  if (!invitation) return NextResponse.json({ error: "This invitation link isn't valid." }, { status: 404 });

  const event = await getEventById(invitation.event_id);
  if (!event) return NextResponse.json({ error: "This event no longer exists." }, { status: 404 });
  if (event.status === "cancelled") return NextResponse.json({ error: "This event has been cancelled." }, { status: 400 });

  const status = computeEffectiveStatus(event);
  const reopened = !!event.rsvp_reopened && status !== "completed";
  if ((status === "rsvp_closed" && !reopened) || status === "completed") {
    return NextResponse.json({ error: "RSVPs for this event are closed." }, { status: 400 });
  }

  const body = await req.json();
  const attending = !!body.attending;
  const numAttending = Math.max(1, Number(body.numAttending) || 1);
  const guestNames: string[] = Array.isArray(body.guestNames) ? body.guestNames : [];
  const answers: { questionId: string; value: string }[] = Array.isArray(body.answers) ? body.answers : [];

  const response = await submitResponse({
    invitationId: invitation.id,
    eventId: event.id,
    attending,
    numAttending: attending ? numAttending : 0,
    guestNames: attending ? guestNames : [],
    responderName: body.responderName || (invitation.invitee ? fullName(invitation.invitee.first_name, invitation.invitee.last_name) : undefined),
    responderEmail: body.responderEmail || invitation.invitee?.email || undefined,
    responderPhone: body.responderPhone || invitation.invitee?.phone || undefined,
    answers,
    reopenedAfterDeadline: isPastDeadline(event.rsvp_deadline) && reopened,
  });

  const to = body.responderEmail || invitation.invitee?.email;
  if (to) {
    sendConfirmationEmail(event, to, invitation.invitee?.first_name || "there", invitation.token, attending).catch(() => {});
  }

  return NextResponse.json({ response });
}
