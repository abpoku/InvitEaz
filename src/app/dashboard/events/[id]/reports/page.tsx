import { getMembership, isCloneScopedRole } from "@/lib/models/events";
import { getCurrentUser } from "@/lib/session";
import { getReportData } from "@/lib/report-data";
import { TicketPaymentCards } from "@/components/reports/TicketPaymentCards";
import { ReportExportMenu, GeneratedStamp } from "@/components/reports/ReportExportMenu";
import { formatCurrency, formatDateShort, formatNumber } from "@/lib/utils";

export default async function ReportsPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  const membership = await getMembership(params.id, user!.id);
  const isCloneScoped = !!membership && isCloneScopedRole(membership.role);
  const assemblyId = isCloneScoped ? membership.assembly_id : null;

  const { event, cloneName, stats, adults, children, questionReports, tickets, clones } = await getReportData(params.id, assemblyId);
  const questions = questionReports.map((r) => r.question);

  return (
    // #report-content is what the image export captures and what printing (PDF) keeps — see
    // ReportExportMenu and the print rules in globals.css.
    <div id="report-content" className="p-4 sm:p-8 max-w-4xl space-y-8 bg-paper">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          {/* Only shown in exports (image/PDF), where the event header above the tabs isn't. */}
          <p className="report-export-only text-sm text-ink-faint">
            {event.name}{cloneName ? ` · ${cloneName}` : ""} · {formatDateShort(event.event_date)}
          </p>
          <h2 className="font-serif text-xl text-ink">Reports</h2>
          <p className="mt-1 text-sm text-ink-soft">A live snapshot of your headcount and RSVP answers.</p>
          <GeneratedStamp />
        </div>
        <ReportExportMenu eventId={params.id} fileBase={event.name} />
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
            <Row label="Maybe" value={stats.maybe} />
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

      {tickets && <TicketPaymentCards eventId={params.id} {...tickets} />}

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
                            <span>{formatNumber(r.count)}</span>
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
            {clones.map(({ clone: c, stats: s, tickets: t }) => {
              return (
                <div key={c.id} className="card p-5">
                  <p className="text-sm text-ink">{c.name}</p>
                  <dl className="mt-3 space-y-1.5 text-sm">
                    <Row label="Invited" value={s.invited} />
                    <Row label="Attending" value={s.attending} />
                    <Row label="Response rate" value={`${s.responseRate}%`} />
                    {t && (
                      <>
                        <Row label="Collected" value={formatCurrency(t.collectedCents)} />
                        <Row label="Outstanding" value={formatCurrency(t.outstandingCents)} />
                      </>
                    )}
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
      <dd className="text-ink font-medium">{typeof value === "number" ? formatNumber(value) : value}</dd>
    </div>
  );
}
