import { CommunicationsCenter } from "@/components/messages/CommunicationsCenter";
import { listGroups } from "@/lib/models/invitees";
import { getMembership, isCloneScopedRole, getEventById } from "@/lib/models/events";
import { twilioConfigured } from "@/lib/sms";
import { listAssemblies } from "@/lib/models/assemblies";
import { getCurrentUser } from "@/lib/session";

export default async function MessagesPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  const membership = await getMembership(params.id, user!.id);
  const assemblyId = membership && isCloneScopedRole(membership.role) ? membership.assembly_id : null;

  const [groups, assemblies, event] = await Promise.all([
    listGroups(params.id, assemblyId),
    assemblyId ? Promise.resolve([]) : listAssemblies(params.id),
    getEventById(params.id),
  ]);

  return (
    <CommunicationsCenter
      eventId={params.id}
      eventName={event?.name || "the event"}
      groups={groups}
      assemblies={assemblies}
      twilioConfigured={twilioConfigured()}
    />
  );
}
