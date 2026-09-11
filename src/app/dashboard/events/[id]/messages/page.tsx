import { CommunicationsCenter } from "@/components/messages/CommunicationsCenter";
import { listGroups } from "@/lib/models/invitees";

export default function MessagesPage({ params }: { params: { id: string } }) {
  const groups = listGroups(params.id);
  return <CommunicationsCenter eventId={params.id} groups={groups} />;
}
