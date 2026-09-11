import { listResponsesForEvent, listQuestions, getAnswersForResponse } from "@/lib/models/rsvp";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/utils";

export default function ResponsesPage({ params }: { params: { id: string } }) {
  const questions = listQuestions(params.id);
  const responses = listResponsesForEvent(params.id) as any[];

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-xl text-ink">Responses</h2>
          <p className="mt-1 text-sm text-ink-soft">{responses.length} response{responses.length === 1 ? "" : "s"} received so far.</p>
        </div>
        <a href={`/api/events/${params.id}/export/responses`} className="btn-secondary">Export CSV</a>
      </div>

      <div className="mt-6 card overflow-x-auto">
        {responses.length === 0 ? (
          <p className="p-10 text-sm text-ink-faint text-center">No responses yet. Once invitees RSVP, they'll show up here in real time.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-paper-line text-left text-ink-faint">
                <th className="px-5 py-3 font-medium whitespace-nowrap">Name</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Status</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap"># Attending</th>
                {questions.map((q) => (
                  <th key={q.id} className="px-5 py-3 font-medium whitespace-nowrap">{q.label}</th>
                ))}
                <th className="px-5 py-3 font-medium whitespace-nowrap">Responded</th>
              </tr>
            </thead>
            <tbody>
              {responses.map((r) => {
                const answers = new Map(getAnswersForResponse(r.id).map((a) => [a.question_id, a.value]));
                return (
                  <tr key={r.id} className="border-b border-paper-line last:border-0 hover:bg-paper-soft/40">
                    <td className="px-5 py-3 text-ink whitespace-nowrap">{r.first_name} {r.last_name}</td>
                    <td className="px-5 py-3"><StatusBadge status={r.attending ? "attending" : "declined"} /></td>
                    <td className="px-5 py-3 text-ink-soft">{r.attending ? r.num_attending : "—"}</td>
                    {questions.map((q) => (
                      <td key={q.id} className="px-5 py-3 text-ink-soft whitespace-nowrap">{answers.get(q.id) || "—"}</td>
                    ))}
                    <td className="px-5 py-3 text-ink-faint whitespace-nowrap">{formatDateTime(r.responded_at)}{r.is_modification ? " (edited)" : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
