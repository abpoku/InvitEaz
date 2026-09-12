import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getEventById, getMembership, computeEffectiveStatus, getEventStats } from "@/lib/models/events";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateShort, formatTime } from "@/lib/utils";
import { EventActions } from "@/components/EventActions";
import { EventTabs } from "@/components/EventTabs";

export default async function EventLayout({ children, params }: { children: React.ReactNode; params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const event = await getEventById(params.id);
  if (!event) notFound();

  const membership = await getMembership(params.id, user.id);
  if (!membership) notFound();

  const stats = await getEventStats(params.id);
  const status = computeEffectiveStatus(event);

  return (
    <div>
      <div className="border-b border-paper-line px-8 py-6">
        <Link href="/dashboard" className="text-sm text-ink-faint hover:text-ink-soft">← All events</Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="font-serif text-2xl text-ink">{event.name}</h1>
              <StatusBadge status={status} />
            </div>
            <p className="mt-1 text-sm text-ink-soft">
              {formatDateShort(event.event_date)} at {formatTime(event.event_time)}
              {event.city ? ` · ${event.city}` : event.location_type === "virtual" ? " · Virtual" : ""}
            </p>
          </div>
          <EventActions event={event} status={status} role={membership.role} />
        </div>

        <div className="mt-6 flex items-center gap-6 text-sm">
          <MiniStat label="Invited" value={stats.invited} />
          <MiniStat label="Attending" value={stats.attending} />
          <MiniStat label="Declined" value={stats.declined} />
          <MiniStat label="No response" value={stats.noResponse} />
          <MiniStat label="Response rate" value={`${stats.responseRate}%`} />
        </div>

        <nav className="mt-6 -mb-6">
          <EventTabs eventId={params.id} />
        </nav>
      </div>
      <div>{children}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <span className="font-serif text-lg text-ink">{value}</span>
      <span className="ml-1.5 text-ink-faint">{label}</span>
    </div>
  );
}
