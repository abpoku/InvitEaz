import Link from "next/link";
import { getEventById, getMembership } from "@/lib/models/events";
import { listInvitees } from "@/lib/models/invitees";
import { listQuestions } from "@/lib/models/rsvp";
import { getCurrentUser } from "@/lib/session";
import { formatDate, formatTime } from "@/lib/utils";
import { ShareCard } from "@/components/ShareCard";

export default async function EventOverviewPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  const membership = await getMembership(params.id, user!.id);
  const isLeadPlanner = membership?.role === "lead_planner";
  const assemblyId = isLeadPlanner ? membership!.assembly_id : null;

  const event = (await getEventById(params.id))!;
  const invitees = await listInvitees(params.id, assemblyId);
  const questions = await listQuestions(params.id);

  const steps = [
    { done: !!event.name && !!event.event_date, label: "Event details added", href: `/dashboard/events/${params.id}/settings` },
    { done: questions.length > 0, label: "RSVP form built", href: `/dashboard/events/${params.id}/rsvp-form` },
    { done: invitees.length > 0, label: "Invitees added", href: `/dashboard/events/${params.id}/invitees` },
    { done: event.status !== "draft", label: "Event published", href: "" },
  ];

  return (
    <div className="p-4 sm:p-8 max-w-5xl grid lg:grid-cols-[1fr_320px] gap-6 sm:gap-8">
      <div className="space-y-6">
        {/* Publishing is a master-planner concern — a lead planner has nothing to do with any of these steps. */}
        {event.status === "draft" && !isLeadPlanner && (
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
          <dl className="mt-4 grid grid-cols-[90px_1fr] sm:grid-cols-[120px_1fr] gap-y-3 gap-x-3 text-sm">
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
