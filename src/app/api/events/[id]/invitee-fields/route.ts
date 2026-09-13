import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEventRole } from "@/lib/session";
import { createInviteeField, listInviteeFields } from "@/lib/models/invitee-fields";

const schema = z.object({
  label: z.string().min(1),
  field_type: z.enum(["text", "email", "phone", "number", "date", "dropdown", "checkbox"]),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  collectAtSignup: z.boolean().optional(),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const access = await requireEventRole(params.id, "viewer");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  return NextResponse.json({ fields: await listInviteeFields(params.id) });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  if (parsed.data.field_type === "dropdown" && (!parsed.data.options || parsed.data.options.length < 2)) {
    return NextResponse.json({ error: "Add at least two options for a dropdown field." }, { status: 400 });
  }

  const field = await createInviteeField(params.id, parsed.data);
  return NextResponse.json({ field });
}
