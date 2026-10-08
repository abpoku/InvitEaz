import { getEventById, getMembership, isCloneScopedRole } from "@/lib/models/events";
import { listAssemblies } from "@/lib/models/assemblies";
import { getTicketingSummary } from "@/lib/models/ticketing";
import { getCurrentUser } from "@/lib/session";
import { CloneFilter } from "@/components/responses/CloneFilter";
import { TicketsManager } from "@/components/tickets/TicketsManager";
import { TicketsSummaryCard } from "@/components/tickets/TicketsSummaryCard";

export default async function TicketsPage({ params, searchParams }: { params: { id: string }; searchParams: { clone?: string } }) {
  const user = await getCurrentUser();
  const membership = await getMembership(params.id, user!.id);
  const isCloneScoped = !!membership && isCloneScopedRole(membership.role);

  const clones = isCloneScoped ? [] : await listAssemblies(params.id);
  const selectedClone = !isCloneScoped && searchParams.clone && clones.some((c) => c.id === searchParams.clone) ? searchParams.clone : null;
  const assemblyId = isCloneScoped ? membership!.assembly_id : selectedClone;

  const event = (await getEventById(params.id))!;
  const summary = event.ticketing_enabled ? await getTicketingSummary(params.id, assemblyId) : null;

  return (
    <div className="p-4 sm:p-8">
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div className="shrink-0">
          <h2 className="font-serif text-xl text-ink">Tickets</h2>
          <p className="mt-1 text-sm text-ink-soft">Record and edit ticket payments.</p>
          {clones.length > 0 && <div className="mt-3"><CloneFilter clones={clones} current={selectedClone || ""} /></div>}
        </div>
        {summary?.fieldLabel && (
          <div className="w-full lg:max-w-2xl">
            <TicketsSummaryCard eventId={params.id} clone={assemblyId} summary={summary}
              exportContext={[event.name, ...(assemblyId ? [clones.find((c) => c.id === assemblyId)?.name || ""] : [])].filter(Boolean)} />
          </div>
        )}
      </div>

      {!event.ticketing_enabled ? (
        <p className="mt-6 rounded border border-brass-200 bg-brass-50 px-4 py-2.5 text-sm text-brass-600">
          Ticketing isn&apos;t set up for this event yet — enable it from Overview.
        </p>
      ) : (
        <TicketsManager eventId={params.id} summary={summary!} canMutate={!membership || membership.role !== "viewer"} />
      )}
    </div>
  );
}
