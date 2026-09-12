import { NextResponse } from "next/server";
import { z } from "zod";
import { getEventBySlug } from "@/lib/models/events";
import { createInvitee } from "@/lib/models/invitees";

const schema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
});

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const event = await getEventBySlug(params.slug);
  if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });
  if (event.visibility === "invite_only") {
    return NextResponse.json({ error: "This event is invitation-only." }, { status: 403 });
  }
  if (event.status !== "published") {
    return NextResponse.json({ error: "This event isn't accepting RSVPs right now." }, { status: 400 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const { invitee, invitation } = await createInvitee(event.id, { ...parsed.data, email: parsed.data.email || undefined });
  return NextResponse.json({ token: invitation.token, inviteeId: invitee.id });
}
