import Link from "next/link";
import { getEventById } from "@/lib/models/events";
import { listInvitees } from "@/lib/models/invitees";
import { listQuestions } from "@/lib/models/rsvp";
import { formatDate, formatTime } from "@/lib/utils";
import { ShareCard } from "@/components/ShareCard";

export default async function EventOverviewPage({ params }: { params: { id: string } }) {
  const event = getEventById(params.id)!;
  const invitees = listInvitees(params.id);
  const questions = listQuestions(params.id);

  const steps = [
    { done: !!event.name && !!event.event_date, label: "Event details added", href: `/dashboard/events/${params.id}/settings` },
    { done: questions.length > 0, label: "RSVP form built", href: `/dashboard/events/${params.id}/rsvp-form` },
    { done: invitees.length > 0, label: "Invitees added", href: `/dashboard/events/${params.id}/invitees` },
    { done: event.status !== "draft", label: "Event published", href: "" },
  ];

  return (
    <div className="p-8 max-w-5xl grid lg:grid-cols-[1fr_320px] gap-8">
      <div className="space-y-6">
        {event.status === "draft" && (
          <div className="card p-6">
            <p className="font-serif text-lg text-ink">Get ready to publish</p>
            <ul className="mt-4 space-y-2.5">
              {steps.map((s) => (
                <li key={s.label} className="flex items-center gap-2.5 text-sm">
                  <span className={`w-4 h-4 rounded-full border flex items-center justify-center text-[10px] ${s.done ? "bg-moss-500 border-moss-500 text-white" : "border-ink/25 text-transparent"}`}>✓</span>
                  {s.href ? (
                    <Link href={s.href} className={s.done ? "text-ink-soft" : "text-ink hover:underline"}>{s.label}</Link>
                  ) : (
                    <span className="text-ink-soft">{s.label}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="card p-6">
          <p className="font-serif text-lg text-ink">Event details</p>
          <dl className="mt-4 grid grid-cols-[120px_1fr] gap-y-3 text-sm">
            <dt className="text-ink-faint">Date & time</dt>
            <dd className="text-ink">{formatDate(event.event_date)} at {formatTime(event.event_time)}{event.end_time ? ` – ${formatTime(event.end_time)}` : ""}</dd>

            <dt className="text-ink-faint">Location</dt>
            <dd className="text-ink">
              {event.location_type === "virtual"
                ? "Virtual event"
                : [event.venue_name, event.address, event.city, event.state].filter(Boolean).join(", ") || "Not set"}
              {event.location_type === "hybrid" && " · also virtual"}
            </dd>

            {event.description && (
              <>
                <dt className="text-ink-faint">Description</dt>
                <dd className="text-ink-soft">{event.description}</dd>
              </>
            )}

            <dt className="text-ink-faint">RSVP deadline</dt>
            <dd className="text-ink">{event.rsvp_deadline ? new Date(event.rsvp_deadline).toLocaleString() : "Not set"}</dd>

            <dt className="text-ink-faint">Visibility</dt>
            <dd className="text-ink">
              {event.visibility === "invite_only" ? "Invited guests only" : event.visibility === "public" ? "Open link" : "Invites + open link"}
            </dd>

            {event.instructions && (
              <>
                <dt className="text-ink-faint">Instructions</dt>
                <dd className="text-ink-soft">{event.instructions}</dd>
              </>
            )}
          </dl>
        </div>
      </div>

      <div className="space-y-6">
        <ShareCard slug={event.slug} visibility={event.visibility} status={event.status} />
      </div>
    </div>
  );
}
