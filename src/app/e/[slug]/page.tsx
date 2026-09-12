import { notFound } from "next/navigation";
import { getEventBySlug, computeEffectiveStatus } from "@/lib/models/events";
import { EnvelopeMark } from "@/components/EnvelopeMark";
import { formatDate, formatTime } from "@/lib/utils";
import { PublicSignupForm } from "@/components/rsvp/PublicSignupForm";

export default async function PublicEventPage({ params }: { params: { slug: string } }) {
  const event = await getEventBySlug(params.slug);
  if (!event || event.status === "draft") notFound();

  const status = computeEffectiveStatus(event);
  const where =
    event.location_type === "virtual"
      ? "Virtual event — link provided after you RSVP"
      : [event.venue_name, event.address, event.city, event.state].filter(Boolean).join(", ") || "Location to be announced";

  return (
    <div className="min-h-screen bg-paper flex flex-col items-center px-4 py-10 sm:py-16">
      <EnvelopeMark className="w-9 h-6" />
      <div className="mt-8 w-full max-w-lg space-y-4">
        <div className="card p-6">
          <p className="text-xs text-ink-faint">{formatDate(event.event_date)}</p>
          <h1 className="mt-1 font-serif text-2xl text-ink leading-tight">{event.name}</h1>
          <p className="mt-2 text-sm text-ink-soft">{formatTime(event.event_time)}{event.end_time ? ` – ${formatTime(event.end_time)}` : ""}</p>
          <p className="text-sm text-ink-soft">{where}</p>
          {event.description && <p className="mt-3 text-sm text-ink-soft leading-relaxed">{event.description}</p>}
        </div>

        {event.status === "cancelled" ? (
          <div className="card p-6 text-center">
            <p className="font-serif text-lg text-ink">This event has been cancelled</p>
            {event.cancellation_message && <p className="mt-2 text-sm text-ink-soft">{event.cancellation_message}</p>}
          </div>
        ) : status === "rsvp_closed" || status === "completed" ? (
          <div className="card p-6 text-center">
            <p className="font-serif text-lg text-ink">RSVPs are closed</p>
            <p className="mt-2 text-sm text-ink-soft">The RSVP window for this event has ended.</p>
          </div>
        ) : event.visibility === "invite_only" ? (
          <div className="card p-6 text-center">
            <p className="font-serif text-lg text-ink">This event is invitation-only</p>
            <p className="mt-2 text-sm text-ink-soft">Please use the personal RSVP link sent to you by the organizer.</p>
          </div>
        ) : (
          <PublicSignupForm slug={event.slug} />
        )}
      </div>
    </div>
  );
}
