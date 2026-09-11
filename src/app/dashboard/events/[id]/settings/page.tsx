import { getEventById, listMembers } from "@/lib/models/events";
import { getCurrentUser } from "@/lib/session";
import { EventSettingsForm } from "@/components/settings/EventSettingsForm";
import { CoPlannersPanel } from "@/components/settings/CoPlannersPanel";
import { DangerZone } from "@/components/settings/DangerZone";

export default async function SettingsPage({ params }: { params: { id: string } }) {
  const event = getEventById(params.id)!;
  const members = listMembers(params.id) as any[];
  const user = await getCurrentUser();
  const isOwner = event.owner_id === user!.id;

  return (
    <div className="p-8 max-w-3xl space-y-8">
      <div>
        <h2 className="font-serif text-xl text-ink">Settings</h2>
        <p className="mt-1 text-sm text-ink-soft">Edit event details, manage co-planners, and control who can RSVP.</p>
      </div>

      <EventSettingsForm event={event} />
      <CoPlannersPanel eventId={params.id} members={members} isOwner={isOwner} />
      {isOwner && <DangerZone eventId={params.id} eventName={event.name} />}
    </div>
  );
}
