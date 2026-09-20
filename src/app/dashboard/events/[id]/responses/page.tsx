import { listResponsesForEvent, listQuestions, getAnswersForResponse } from "@/lib/models/rsvp";
import { getMembership, isCloneScopedRole } from "@/lib/models/events";
import { listAssemblies } from "@/lib/models/assemblies";
import { getCurrentUser } from "@/lib/session";
import { StatusBadge } from "@/components/StatusBadge";
import { CloneFilter } from "@/components/responses/CloneFilter";
import { formatDateTime, fullName } from "@/lib/utils";

export default async function ResponsesPage({ params, searchParams }: { params: { id: string }; searchParams: { clone?: string } }) {
  const user = await getCurrentUser();
  const membership = await getMembership(params.id, user!.id);
  const isCloneScoped = !!membership && isCloneScopedRole(membership.role);

  const clones = isCloneScoped ? [] : await listAssemblies(params.id);
  const selectedClone = !isCloneScoped && searchParams.clone && clones.some((c) => c.id === searchParams.clone) ? searchParams.clone : null;
  const assemblyId = isCloneScoped ? membership.assembly_id : selectedClone;

  const questions = await listQuestions(params.id);
  const responses = (await listResponsesForEvent(params.id, assemblyId)) as any[];
  const responsesWithAnswers = await Promise.all(
    responses.map(async (r) => ({
      response: r,
      answers: new Map((await getAnswersForResponse(r.id)).map((a) => [a.question_id, a.value])),
    }))
  );
  const cloneNameById = new Map(clones.map((c) => [c.id, c.name]));

  return (
    <div className="p-4 sm:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl text-ink">Responses</h2>
          <p className="mt-1 text-sm text-ink-soft">{responses.length} response{responses.length === 1 ? "" : "s"} received so far.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {clones.length > 0 && <CloneFilter clones={clones} current={selectedClone || ""} />}
          <a href={`/api/events/${params.id}/export/responses`} className="btn-secondary shrink-0">Export CSV</a>
        </div>
      </div>

      <div className="mt-6 card overflow-x-auto">
        {responses.length === 0 ? (
          <p className="p-10 text-sm text-ink-faint text-center">No responses yet. Once invitees RSVP, they'll show up here in real time.</p>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-paper-line text-left text-ink-faint">
                <th className="px-5 py-3 font-medium whitespace-nowrap">Name</th>
                {clones.length > 0 && <th className="px-5 py-3 font-medium whitespace-nowrap">Clone</th>}
                <th className="px-5 py-3 font-medium whitespace-nowrap">Status</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap"># Attending</th>
                {questions.map((q) => (
                  <th key={q.id} className="px-5 py-3 font-medium whitespace-nowrap">{q.label}</th>
                ))}
                <th className="px-5 py-3 font-medium whitespace-nowrap">Responded</th>
              </tr>
            </thead>
            <tbody>
              {responsesWithAnswers.map(({ response: r, answers }) => {
                return (
                  <tr key={r.id} className="border-b border-paper-line last:border-0 hover:bg-paper-soft/40">
                    <td className="px-5 py-3 text-ink whitespace-nowrap">{fullName(r.first_name, r.last_name)}</td>
                    {clones.length > 0 && (
                      <td className="px-5 py-3 text-ink-soft whitespace-nowrap">{cloneNameById.get(r.assembly_id) || "Unassigned"}</td>
                    )}
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
