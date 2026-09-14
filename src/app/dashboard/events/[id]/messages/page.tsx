import { CommunicationsCenter } from "@/components/messages/CommunicationsCenter";
import { listGroups } from "@/lib/models/invitees";
import { getMembership } from "@/lib/models/events";
import { listAssemblies } from "@/lib/models/assemblies";
import { getCurrentUser } from "@/lib/session";

export default async function MessagesPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  const membership = await getMembership(params.id, user!.id);
  const assemblyId = membership?.role === "lead_planner" ? membership.assembly_id : null;

  const [groups, assemblies] = await Promise.all([
    listGroups(params.id, assemblyId),
    assemblyId ? Promise.resolve([]) : listAssemblies(params.id),
  ]);

  return <CommunicationsCenter eventId={params.id} groups={groups} assemblies={assemblies} />;
}
