import { requireEventRole } from "@/lib/session";
import { listResponsesForEvent, listQuestions, getAnswersForResponse } from "@/lib/models/rsvp";

function csvEscape(v: any): string {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const access = await requireEventRole(params.id, "viewer");
  if (!access.ok) return new Response(access.message, { status: access.status });

  const questions = listQuestions(params.id);
  const responses = listResponsesForEvent(params.id) as any[];

  const headers = ["First Name", "Last Name", "Attending", "Number Attending", "Guest Names", "Responded At", ...questions.map((q) => q.label)];
  const lines = [headers.join(",")];

  for (const r of responses) {
    const answers = getAnswersForResponse(r.id);
    const answerMap = new Map(answers.map((a) => [a.question_id, a.value]));
    const guestNames = r.guest_names_json ? JSON.parse(r.guest_names_json).join("; ") : "";
    lines.push([
      csvEscape(r.first_name), csvEscape(r.last_name), csvEscape(r.attending ? "Yes" : "No"),
      csvEscape(r.num_attending), csvEscape(guestNames), csvEscape(r.responded_at),
      ...questions.map((q) => csvEscape(answerMap.get(q.id) || "")),
    ].join(","));
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="rsvp-responses-${params.id}.csv"`,
    },
  });
}
