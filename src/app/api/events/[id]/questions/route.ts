import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEventRole } from "@/lib/session";
import { createQuestion, listQuestions } from "@/lib/models/rsvp";

const schema = z.object({
  label: z.string().min(1),
  type: z.enum(["short_text", "long_text", "single_choice", "multiple_choice", "dropdown", "yes_no", "number", "date", "time", "email", "phone", "checkbox"]),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  showIfAttending: z.enum(["yes", "no"]).nullable().optional(),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const access = await requireEventRole(params.id, "viewer");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  return NextResponse.json({ questions: await listQuestions(params.id) });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const question = await createQuestion(params.id, parsed.data);
  return NextResponse.json({ question });
}
