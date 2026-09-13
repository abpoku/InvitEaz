import { NextResponse } from "next/server";
import { getEventBySlug } from "@/lib/models/events";
import { listInviteeFields } from "@/lib/models/invitee-fields";

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const event = await getEventBySlug(params.slug);
  if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

  const fields = (await listInviteeFields(event.id))
    .filter((f) => f.active && f.collect_at_signup)
    .map((f) => ({ key: f.key, label: f.label, kind: f.kind, field_type: f.field_type, options_json: f.options_json, required: f.required }));

  return NextResponse.json({ fields, nameFormat: event.invitee_name_format });
}
