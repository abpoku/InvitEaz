import { InviteesManager } from "@/components/invitees/InviteesManager";
import { getEventById } from "@/lib/models/events";

export default async function InviteesPage({ params }: { params: { id: string } }) {
  const event = getEventById(params.id)!;
  return <InviteesManager eventId={params.id} groupRsvpMode={event.group_rsvp_mode} />;
}
