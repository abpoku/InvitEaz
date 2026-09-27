import { listInviteeResponseRows, listQuestions, getAnswersForResponse } from "@/lib/models/rsvp";
import { getMembership, isCloneScopedRole } from "@/lib/models/events";
import { listAssemblies } from "@/lib/models/assemblies";
import { getCurrentUser } from "@/lib/session";
import { CloneFilter } from "@/components/responses/CloneFilter";
import { ResponsesManager } from "@/components/responses/ResponsesManager";

export default async function ResponsesPage({ params, searchParams }: { params: { id: string }; searchParams: { clone?: string } }) {
  const user = await getCurrentUser();
  const membership = await getMembership(params.id, user!.id);
  const isCloneScoped = !!membership && isCloneScopedRole(membership.role);

  const clones = isCloneScoped ? [] : await listAssemblies(params.id);
  const selectedClone = !isCloneScoped && searchParams.clone && clones.some((c) => c.id === searchParams.clone) ? searchParams.clone : null;
  const assemblyId = isCloneScoped ? membership!.assembly_id : selectedClone;

  const questions = await listQuestions(params.id);
  const rows = await listInviteeResponseRows(params.id, assemblyId);
  const answersByResponseId: Record<string, { question_id: string; value: string | null }[]> = {};
  for (const row of rows) {
    if (row.response_id) answersByResponseId[row.response_id] = await getAnswersForResponse(row.response_id);
  }
  const cloneNameById = new Map(clones.map((c) => [c.id, c.name]));

  return (
    <div className="p-4 sm:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl text-ink">Responses</h2>
          <p className="mt-1 text-sm text-ink-soft">{rows.length} invitee{rows.length === 1 ? "" : "s"} — set a status manually for anyone who responded by phone or in person.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {clones.length > 0 && <CloneFilter clones={clones} current={selectedClone || ""} />}
          <a href={`/api/events/${params.id}/export/responses`} className="btn-secondary shrink-0">Export CSV</a>
        </div>
      </div>

      <ResponsesManager
        eventId={params.id}
        rows={rows}
        answersByResponseId={answersByResponseId}
        questions={questions}
        cloneNameById={Object.fromEntries(cloneNameById)}
        showCloneColumn={clones.length > 0}
        canMutate={!membership || membership.role !== "viewer"}
      />
    </div>
  );
}
