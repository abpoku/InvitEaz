"use client";

import { useEffect, useState } from "react";
import { ClonePlanners } from "@/components/assemblies/ClonePlanners";

interface Member { id: string; role: string; status: string; invited_email: string; email: string | null; assembly_id: string | null; }

export function LeadPlannerCoPlanners({ eventId, assemblyId }: { eventId: string; assemblyId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    // The server scopes this to just our own clone's roster (lead planner/co-planners) — no
    // visibility into other clones or the whole-event admin/viewer list.
    const res = await fetch(`/api/events/${eventId}/members`);
    if (res.ok) setMembers((await res.json()).members || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const coPlanners = members.filter((m) => m.role === "co_planner");

  return (
    <div className="card p-6">
      <h2 className="font-serif text-xl text-ink">Your co-planners</h2>
      <p className="mt-1 text-sm text-ink-soft">Invite up to 3 people to help you manage this clone's invitees, messages, and reports.</p>
      {loading ? (
        <p className="mt-4 text-sm text-ink-faint">Loading…</p>
      ) : (
        <ClonePlanners eventId={eventId} assemblyId={assemblyId} planners={coPlanners} onChange={load} />
      )}
    </div>
  );
}
