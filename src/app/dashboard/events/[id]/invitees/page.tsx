import { InviteesManager, type InviteesInitialData } from "@/components/invitees/InviteesManager";
import { getEventById } from "@/lib/models/events";
import { requireAssemblyScope } from "@/lib/session";
import { listInvitees, listGroups } from "@/lib/models/invitees";
import { listInviteeFields } from "@/lib/models/invitee-fields";
import { listAssemblies } from "@/lib/models/assemblies";
import { getTicketingConfig } from "@/lib/models/ticketing";

export default async function InviteesPage({ params }: { params: { id: string } }) {
  const event = (await getEventById(params.id))!;

  // The table's first load happens here, on the server, so the page arrives already filled in —
  // the client used to render "Loading invitees…" and then make five more API round trips (each
  // re-checking the session and membership) before showing anything. Same access rules as those
  // routes (GET invitees/invitee-fields/assemblies/ticketing/groups); later refreshes still go
  // through them via InviteesManager's load().
  let initialData: InviteesInitialData | undefined;
  const access = await requireAssemblyScope(params.id);
  if (access.ok) {
    const scoped = !!access.assemblyId;
    const [invitees, fields, assemblies, ticketing, groups] = await Promise.all([
      listInvitees(params.id, access.assemblyId),
      listInviteeFields(params.id),
      // The assemblies route refuses clone-scoped roles, and ticketing's requireEventRole("viewer")
      // always fails for them — the client treats both refusals as "none", so do the same here.
      scoped ? Promise.resolve([]) : listAssemblies(params.id),
      scoped ? Promise.resolve(null) : getTicketingConfig(params.id),
      listGroups(params.id, access.assemblyId),
    ]);
    initialData = {
      invitees: invitees as InviteesInitialData["invitees"],
      fields: fields as unknown as InviteesInitialData["fields"],
      assemblies,
      ticketFieldId: ticketing?.field?.id ?? null,
      groups: groups as InviteesInitialData["groups"],
    };
  }

  return <InviteesManager eventId={params.id} groupRsvpMode={event.group_rsvp_mode} nameFormat={event.invitee_name_format} eventName={event.name} initialData={initialData} />;
}
