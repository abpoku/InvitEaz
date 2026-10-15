import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getEventById, getMembership, computeEffectiveStatus, getEventStats, isCloneScopedRole } from "@/lib/models/events";
import { getAssembly, getAssemblyStats, listAssemblies } from "@/lib/models/assemblies";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateShort, formatTime } from "@/lib/utils";
import { EventActions } from "@/components/EventActions";
import { EventTabs } from "@/components/EventTabs";
import { EventHeaderStats } from "@/components/EventHeaderStats";

export default async function EventLayout({ children, params }: { children: React.ReactNode; params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const event = await getEventById(params.id);
  if (!event) notFound();

  const membership = await getMembership(params.id, user.id);
  if (!membership) notFound();

  const isCloneScoped = isCloneScopedRole(membership.role);
  const assembly = isCloneScoped && membership.assembly_id ? await getAssembly(membership.assembly_id) : null;
  const stats = isCloneScoped
    ? await getAssemblyStats(params.id, membership.assembly_id)
    : await getEventStats(params.id);
  const status = computeEffectiveStatus(event);

  // Each clone's numbers (plus Unassigned), so the header can follow a tab's clone filter without a
  // round trip. Full-event roles only — a clone-scoped planner's stats above are already their clone.
  const clones = isCloneScoped ? [] : await listAssemblies(params.id);
  const byClone = clones.length > 0
    ? Object.fromEntries(await Promise.all([
        ...clones.map(async (c) => [c.id, { name: c.name, stats: await getAssemblyStats(params.id, c.id) }] as const),
        (async () => ["unassigned", { name: "Unassigned", stats: await getAssemblyStats(params.id, null) }] as const)(),
      ]))
    : undefined;

  return (
    <div>
      <div data-print-hide className="border-b border-paper-line px-4 sm:px-8 py-5 sm:py-6">
        <Link href="/dashboard" className="text-sm text-ink-faint hover:text-ink-soft">← All events</Link>
        <div className="mt-2 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="font-serif text-2xl text-ink break-words">{event.name}</h1>
              <StatusBadge status={status} />
              {assembly && <span className="chip bg-wine-500/10 text-wine-600">{assembly.name}</span>}
            </div>
            <p className="mt-1 text-sm text-ink-soft">
              {formatDateShort(event.event_date)} at {formatTime(event.event_time)}
              {event.city ? ` · ${event.city}` : event.location_type === "virtual" ? " · Virtual" : ""}
            </p>
          </div>
          <EventActions event={event} status={status} role={membership.role} />
        </div>

        <EventHeaderStats stats={stats} byClone={byClone} />

        <nav className="mt-6 -mb-6">
          <EventTabs eventId={params.id} role={membership.role} />
        </nav>
      </div>
      <div>{children}</div>
    </div>
  );
}
