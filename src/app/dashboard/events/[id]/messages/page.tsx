import { CommunicationsCenter } from "@/components/messages/CommunicationsCenter";
import { listGroups } from "@/lib/models/invitees";

export default async function MessagesPage({ params }: { params: { id: string } }) {
  const groups = await listGroups(params.id);
  return <CommunicationsCenter eventId={params.id} groups={groups} />;
}
