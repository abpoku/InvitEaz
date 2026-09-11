import { getEventStats } from "@/lib/models/events";
import { listQuestions, questionReport } from "@/lib/models/rsvp";
import { listInvitees } from "@/lib/models/invitees";

export default function ReportsPage({ params }: { params: { id: string } }) {
  const stats = getEventStats(params.id);
  const questions = listQuestions(params.id);
  const invitees = listInvitees(params.id);
  const adults = invitees.filter((i) => i.is_adult && i.status === "attending").length;
  const children = invitees.filter((i) => !i.is_adult && i.status === "attending").length;

  return (
    <div className="p-8 max-w-4xl space-y-8">
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
            {questions.map((q) => {
              const rows = questionReport(params.id, q.id).filter((r) => r.value);
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
