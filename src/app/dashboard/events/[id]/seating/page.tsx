import { notFound } from "next/navigation";
import { getEventById, getMembership, isCloneScopedRole } from "@/lib/models/events";
import { requireUser } from "@/lib/session";
import { SeatingManager } from "@/components/seating/SeatingManager";

export default async function SeatingPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const membership = await getMembership(params.id, user.id);
  const event = await getEventById(params.id);
  if (!membership || !event) notFound();

  if (isCloneScopedRole(membership.role) && !membership.seating_access) {
    return (
      <div className="p-4 sm:p-8">
        <h2 className="font-serif text-xl text-ink">Seating</h2>
        <p className="mt-3 rounded border border-brass-200 bg-brass-50 px-4 py-2.5 text-sm text-brass-600">
          The event owner hasn&apos;t given you access to seating yet.
        </p>
      </div>
    );
  }

  return <SeatingManager eventId={params.id} eventName={event.name} />;
}
