import { notFound } from "next/navigation";
import { getEventById, getMembership, listMembers } from "@/lib/models/events";
import { listAssemblies } from "@/lib/models/assemblies";
import { getCurrentUser } from "@/lib/session";
import { AssembliesManager } from "@/components/assemblies/AssembliesManager";

export default async function AssembliesPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  const membership = await getMembership(params.id, user!.id);
  if (!membership || membership.role === "lead_planner") notFound();

  const [event, assemblies, members] = await Promise.all([
    getEventById(params.id),
    listAssemblies(params.id),
    listMembers(params.id) as Promise<any[]>,
  ]);

  return (
    <AssembliesManager
      eventId={params.id}
      canManage={membership.role === "owner" || membership.role === "admin"}
      isOwner={event!.owner_id === user!.id}
      initialAssemblies={assemblies}
      initialMembers={members}
    />
  );
}
