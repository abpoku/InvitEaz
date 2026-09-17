import { getEventStats, getMembership } from "@/lib/models/events";
import { getAssemblyStats, listAssemblies } from "@/lib/models/assemblies";
import { listQuestions, questionReport } from "@/lib/models/rsvp";
import { listInvitees } from "@/lib/models/invitees";
import { getCurrentUser } from "@/lib/session";

export default async function ReportsPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  const membership = await getMembership(params.id, user!.id);
  const isLeadPlanner = membership?.role === "lead_planner";
  const assemblyId = isLeadPlanner ? membership.assembly_id : null;

  const stats = isLeadPlanner ? await getAssemblyStats(params.id, assemblyId) : await getEventStats(params.id);
  const questions = await listQuestions(params.id);
  const invitees = await listInvitees(params.id, assemblyId);
  const adults = invitees.filter((i) => i.is_adult && i.status === "attending").length;
  const children = invitees.filter((i) => !i.is_adult && i.status === "attending").length;

  const questionReports = await Promise.all(
    questions.map(async (q) => ({
      question: q,
      rows: (await questionReport(params.id, q.id, assemblyId)).filter((r) => r.value),
    }))
  );

  const clones = isLeadPlanner ? [] : await listAssemblies(params.id);
  const cloneStats = clones.length > 0 ? await Promise.all(clones.map((c) => getAssemblyStats(params.id, c.id))) : [];

  return (
    <div className="p-4 sm:p-8 max-w-4xl space-y-8">
      <div>
        <h2 className="font-serif text-xl text-ink">Reports</h2>
        <p className="mt-1 text-sm text-ink-soft">A live snapshot of your headcount and RSVP answers.</p>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <div className="card p-6">
          <p className="text-sm text-ink-faint">Invitation summary</p>
          <dl className="mt-3 space-y-1.5 text-sm">
            <Row label="Invited" value={stats.invited} />
            <Row label="Responded" value={stats.responded} />
            <Row label="No response" value={stats.noResponse} />
            <Row label="Response rate" value={`${stats.responseRate}%`} />
          </dl>
        </div>
        <div className="card p-6">
          <p className="text-sm text-ink-faint">RSVP summary</p>
          <dl className="mt-3 space-y-1.5 text-sm">
            <Row label="Attending" value={stats.attending} />
            <Row label="Declined" value={stats.declined} />
            <Row label="Pending" value={stats.noResponse} />
          </dl>
        </div>
        <div className="card p-6">
          <p className="text-sm text-ink-faint">Attendance</p>
          <dl className="mt-3 space-y-1.5 text-sm">
            <Row label="Total attendees" value={stats.totalAttendees} />
            <Row label="Adults" value={adults} />
            <Row label="Children" value={children} />
          </dl>
        </div>
      </div>

      {questions.length > 0 && (
        <div>
          <h3 className="font-serif text-lg text-ink">Question breakdown</h3>
          <div className="mt-4 grid md:grid-cols-2 gap-5">
            {questionReports.map(({ question: q, rows }) => {
              const max = Math.max(1, ...rows.map((r) => r.count));
              return (
                <div key={q.id} className="card p-5">
                  <p className="text-sm text-ink">{q.label}</p>
                  {rows.length === 0 ? (
                    <p className="mt-2 text-xs text-ink-faint">No answers yet.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {rows.map((r) => (
                        <div key={r.value}>
                          <div className="flex items-center justify-between text-xs text-ink-soft mb-1">
                            <span>{r.value}</span>
                            <span>{r.count}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-paper-soft overflow-hidden">
                            <div className="h-full bg-wine-400 rounded-full" style={{ width: `${(r.count / max) * 100}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {clones.length > 0 && (
        <div>
          <h3 className="font-serif text-lg text-ink">By clone</h3>
          <div className="mt-4 grid sm:grid-cols-2 md:grid-cols-3 gap-4">
            {clones.map((c, idx) => {
              const s = cloneStats[idx];
              return (
                <div key={c.id} className="card p-5">
                  <p className="text-sm text-ink">{c.name}</p>
                  <dl className="mt-3 space-y-1.5 text-sm">
                    <Row label="Invited" value={s.invited} />
                    <Row label="Attending" value={s.attending} />
                    <Row label="Response rate" value={`${s.responseRate}%`} />
                  </dl>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="text-ink font-medium">{value}</dd>
    </div>
  );
}
