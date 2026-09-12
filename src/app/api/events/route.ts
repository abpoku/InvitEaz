import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { createEvent, listEventsForUser } from "@/lib/models/events";
import { PLAN_LIMITS } from "@/lib/models/users";
import { logAudit } from "@/lib/models/events";

const schema = z.object({
  name: z.string().min(1),
  date: z.string().min(1),
  time: z.string().min(1),
  endTime: z.string().optional(),
  description: z.string().optional(),
  locationType: z.enum(["physical", "virtual", "hybrid"]).default("physical"),
  venueName: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  country: z.string().optional(),
  meetingUrl: z.string().optional(),
  meetingInstructions: z.string().optional(),
  organizerName: z.string().optional(),
  organizerContact: z.string().optional(),
  website: z.string().optional(),
  dressCode: z.string().optional(),
  instructions: z.string().optional(),
  rsvpDeadline: z.string().optional(),
  visibility: z.enum(["invite_only", "public", "hybrid"]).optional(),
  groupRsvpMode: z.enum(["group", "individual", "primary_contact"]).optional(),
  defaultPlusOnePolicy: z.enum(["none", "one", "multiple"]).optional(),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  return NextResponse.json({ events: await listEventsForUser(user.id) });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const existing = (await listEventsForUser(user.id)).filter((e) => e.status !== "cancelled");
  const limit = PLAN_LIMITS[user.plan].activeEvents;
  if (existing.length >= limit) {
    return NextResponse.json(
      { error: `Your ${PLAN_LIMITS[user.plan].label} plan allows up to ${limit} active events. Upgrade to create more.` },
      { status: 402 }
    );
  }

  const event = await createEvent(user.id, parsed.data);
  await logAudit(event.id, user.email, "event.created", event.name);
  return NextResponse.json({ event });
}
