import { NextResponse } from "next/server";
import { z } from "zod";
import { getEventBySlug } from "@/lib/models/events";
import { createInvitee, createGroup, listGroups } from "@/lib/models/invitees";

const schema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().optional().default(""),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  group: z.string().optional(),
  isAdult: z.boolean().optional(),
  plusOnePolicy: z.enum(["none", "one", "multiple"]).nullable().optional(),
  notes: z.string().optional(),
  customFields: z.record(z.string()).optional(),
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
  const { group: groupName, ...rest } = parsed.data;

  let groupId: string | null = null;
  if (groupName) {
    const existing = (await listGroups(event.id)).find((g) => g.name.toLowerCase() === groupName.toLowerCase());
    groupId = existing ? existing.id : (await createGroup(event.id, groupName)).id;
  }

  const { invitee, invitation } = await createInvitee(event.id, { ...rest, email: rest.email || undefined, groupId });
  return NextResponse.json({ token: invitation.token, inviteeId: invitee.id });
}
