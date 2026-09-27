import { listInviteeResponseRows, listQuestions, getAnswersForResponse } from "@/lib/models/rsvp";
import { getEventById, getMembership, isCloneScopedRole } from "@/lib/models/events";
import { listAssemblies } from "@/lib/models/assemblies";
import { getTicketingConfig, priceForInvitee, sumPaymentsByInvitee, sumPaymentsByGroup } from "@/lib/models/ticketing";
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

  const event = (await getEventById(params.id))!;
  const questions = await listQuestions(params.id);
  const rows = await listInviteeResponseRows(params.id, assemblyId);
  const answersByResponseId: Record<string, { question_id: string; value: string | null }[]> = {};
  for (const row of rows) {
    if (row.response_id) answersByResponseId[row.response_id] = await getAnswersForResponse(row.response_id);
  }
  const cloneNameById = new Map(clones.map((c) => [c.id, c.name]));

  let ticketing = null as null | {
    fieldLabel: string | null;
    fieldKey: string | null;
    tierOptions: string[];
    tierByInvitee: Record<string, string>;
    owedByInvitee: Record<string, number>;
    paidByInvitee: Record<string, number>;
    groupOwed: Record<string, number>;
    paidByGroup: Record<string, number>;
    groupNameById: Record<string, string>;
  };

  if (event.ticketing_enabled) {
    const config = await getTicketingConfig(params.id);
    const tierByInvitee: Record<string, string> = {};
    const owedByInvitee: Record<string, number> = {};
    const groupOwed: Record<string, number> = {};
    const groupNameById: Record<string, string> = {};
    for (const row of rows) {
      let tierValue = "";
      if (config.field && row.custom_fields) {
        try { tierValue = JSON.parse(row.custom_fields)?.[config.field.key] || ""; } catch { tierValue = ""; }
      }
      if (tierValue) tierByInvitee[row.invitee_id] = tierValue;
      const owed = config.field ? priceForInvitee(row.custom_fields, config.field.key, config.tiers) : 0;
      owedByInvitee[row.invitee_id] = owed;
      if (row.group_id) {
        groupOwed[row.group_id] = (groupOwed[row.group_id] || 0) + owed;
        if (row.group_name) groupNameById[row.group_id] = row.group_name;
      }
    }
    ticketing = {
      fieldLabel: config.field?.label ?? null,
      fieldKey: config.field?.key ?? null,
      tierOptions: config.tiers.map((t) => t.option_value),
      tierByInvitee,
      owedByInvitee,
      paidByInvitee: await sumPaymentsByInvitee(params.id, assemblyId),
      groupOwed,
      paidByGroup: await sumPaymentsByGroup(params.id, assemblyId),
      groupNameById,
    };
  }

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
        ticketing={ticketing}
      />
    </div>
  );
}
