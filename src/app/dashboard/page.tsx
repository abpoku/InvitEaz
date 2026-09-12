import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { listEventsForUser, getEventStats, computeEffectiveStatus } from "@/lib/models/events";
import { formatDateShort } from "@/lib/utils";
import { StatusBadge } from "@/components/StatusBadge";
import { PLAN_LIMITS } from "@/lib/models/users";
import { EnvelopeMark } from "@/components/EnvelopeMark";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const events = await listEventsForUser(user!.id);

  const upcoming = events.filter((e) => computeEffectiveStatus(e) !== "completed" && computeEffectiveStatus(e) !== "cancelled");
  const past = events.filter((e) => computeEffectiveStatus(e) === "completed");

  let totalInvitees = 0, totalConfirmed = 0, awaiting = 0;
  const rows = await Promise.all(events.map(async (e) => {
    const stats = await getEventStats(e.id);
    totalInvitees += stats.invited;
    totalConfirmed += stats.attending;
    awaiting += stats.noResponse;
    return { event: e, stats };
  }));

  const limits = PLAN_LIMITS[user!.plan];

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-2xl text-ink">Good to see you, {user!.first_name}.</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {events.length === 0 ? "Let's create your first event." : `You're managing ${events.length} event${events.length === 1 ? "" : "s"}.`}
          </p>
        </div>
        <Link href="/dashboard/events/new" className="btn-primary">+ Create new event</Link>
      </div>

      {/* Summary cards */}
      <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="Upcoming events" value={upcoming.length} />
        <SummaryCard label="Past events" value={past.length} />
        <SummaryCard label="Total invitees" value={totalInvitees} />
        <SummaryCard label="Awaiting response" value={awaiting} />
      </div>

      {events.length > 0 && (
        <p className="mt-3 text-xs text-ink-faint">
          {events.filter((e) => e.status !== "draft" && e.status !== "cancelled").length} / {limits.activeEvents === Infinity ? "∞" : limits.activeEvents} active events used on your {limits.label} plan.
        </p>
      )}

      {/* Event list */}
      <div className="mt-10">
        <h2 className="font-serif text-lg text-ink mb-3">Your events</h2>
        {events.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="card divide-y divide-paper-line">
            {rows.map(({ event, stats }) => (
              <Link
                key={event.id}
                href={`/dashboard/events/${event.id}`}
                className="flex items-center justify-between px-5 py-4 hover:bg-paper-soft/50 transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <p className="font-medium text-ink truncate">{event.name}</p>
                    <StatusBadge status={computeEffectiveStatus(event)} />
                  </div>
                  <p className="mt-1 text-sm text-ink-faint">
                    {formatDateShort(event.event_date)} · {event.city || (event.location_type === "virtual" ? "Virtual" : "Location TBD")}
                  </p>
                </div>
                <div className="hidden sm:flex items-center gap-6 text-sm text-right shrink-0 ml-4">
                  <Stat label="Invited" value={stats.invited} />
                  <Stat label="Attending" value={stats.attending} />
                  <Stat label="Declined" value={stats.declined} />
                  <Stat label="No response" value={stats.noResponse} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="card p-5">
      <p className="text-sm text-ink-faint">{label}</p>
      <p className="mt-1.5 font-serif text-3xl text-ink">{value}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="font-serif text-lg text-ink leading-none">{value}</p>
      <p className="text-xs text-ink-faint mt-1">{label}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card p-14 flex flex-col items-center text-center">
      <EnvelopeMark className="w-12 h-8 opacity-70" />
      <p className="mt-4 font-serif text-lg text-ink">Nothing on the calendar yet</p>
      <p className="mt-1.5 text-sm text-ink-soft max-w-sm">
        Create your first event, and we'll help you build the guest list, the RSVP form, and the reminders that go with it.
      </p>
      <Link href="/dashboard/events/new" className="btn-primary mt-6">+ Create new event</Link>
    </div>
  );
}
