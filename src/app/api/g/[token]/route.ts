import { NextResponse } from "next/server";
import { loadGroupInvitation, submitGroupResponse, GroupRsvpError } from "@/lib/models/group-rsvp";
import { sendGroupConfirmationEmail } from "@/lib/notify";

// Public, unauthenticated — the group's rsvp_token *is* the credential, exactly like /api/rsvp/[token].

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  try {
    const data = await loadGroupInvitation(params.token);
    if (data.members.length === 0) {
      return NextResponse.json({ error: "This group invitation doesn't have any guests yet. Please contact the organizer." }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof GroupRsvpError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  let body: any = {};
  try { body = await req.json(); } catch {}
  try {
    const result = await submitGroupResponse(params.token, {
      responder: body.responder || {},
      members: Array.isArray(body.members) ? body.members : [],
      removeInviteeIds: Array.isArray(body.removeInviteeIds) ? body.removeInviteeIds : [],
    });
    if (result.responderEmail) {
      sendGroupConfirmationEmail(
        result.event, result.responderEmail, result.responderName, result.group.name, result.group.rsvp_token,
        result.attendingCount, body.members.length
      ).catch(() => {});
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof GroupRsvpError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
