import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAssemblyScope } from "@/lib/session";
import { createInvitee, listInvitees, countActiveInvitees } from "@/lib/models/invitees";
import { getUserById, PLAN_LIMITS } from "@/lib/models/users";
import { getEventById, logAudit } from "@/lib/models/events";
import { getAssembly } from "@/lib/models/assemblies";
import { fullName } from "@/lib/utils";

const schema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().optional().default(""),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  isAdult: z.boolean().optional(),
  plusOnePolicy: z.enum(["none", "one", "multiple"]).nullable().optional(),
  notes: z.string().optional(),
  groupId: z.string().nullable().optional(),
  assemblyId: z.string().nullable().optional(),
  customFields: z.record(z.string()).optional(),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  return NextResponse.json({ invitees: await listInvitees(params.id, access.assemblyId) });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  if (access.role === "viewer") return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });

  const event = await getEventById(params.id);
  if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

  const owner = (await getUserById(event.owner_id))!;
  const limit = PLAN_LIMITS[owner.plan].inviteesPerEvent;
  if ((await countActiveInvitees(params.id)) >= limit) {
    return NextResponse.json({ error: `This plan allows up to ${limit} invitees per event. Upgrade to add more.` }, { status: 402 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  // A lead planner can only ever create invitees within their own assembly — never trust a
  // client-supplied assemblyId for them. A full-scope planner may target any assembly (or none).
  let assemblyId: string | null = null;
  if (access.assemblyId) {
    assemblyId = access.assemblyId;
  } else if (parsed.data.assemblyId) {
    const assembly = await getAssembly(parsed.data.assemblyId);
    if (!assembly || assembly.event_id !== params.id) return NextResponse.json({ error: "Clone not found." }, { status: 404 });
    assemblyId = assembly.id;
  }

  const { invitee, invitation } = await createInvitee(params.id, { ...parsed.data, email: parsed.data.email || undefined, assemblyId });
  await logAudit(params.id, access.user.email, "invitee.added", fullName(invitee.first_name, invitee.last_name));
  return NextResponse.json({ invitee: { ...invitee, token: invitation.token, status: invitation.status } });
}
