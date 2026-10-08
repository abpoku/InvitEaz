import { getEventById, getEventStats } from "@/lib/models/events";
import { getAssembly, getAssemblyStats, listAssemblies } from "@/lib/models/assemblies";
import { listQuestions, questionReport } from "@/lib/models/rsvp";
import { listInvitees } from "@/lib/models/invitees";
import { getTicketingSummary, listCollected, listDonations } from "@/lib/models/ticketing";

/** Everything the Reports tab shows — loaded in one place so the page and its Excel/CSV export
 * (export/report route) always contain the same numbers. `assemblyId` is the caller's clone scope
 * (null = whole event); a clone-scoped planner gets their clone only, and no per-clone section. */
export async function getReportData(eventId: string, assemblyId: string | null) {
  const event = (await getEventById(eventId))!;
  const [stats, questions, invitees, clone, clones] = await Promise.all([
    assemblyId ? getAssemblyStats(eventId, assemblyId) : getEventStats(eventId),
    listQuestions(eventId),
    listInvitees(eventId, assemblyId),
    assemblyId ? getAssembly(assemblyId) : Promise.resolve(null),
    assemblyId ? Promise.resolve([]) : listAssemblies(eventId),
  ]);
  const adults = invitees.filter((i) => i.is_adult && i.status === "attending").length;
  const children = invitees.filter((i) => !i.is_adult && i.status === "attending").length;

  const questionReports = await Promise.all(
    questions.map(async (q) => ({
      question: q,
      rows: (await questionReport(eventId, q.id, assemblyId)).filter((r) => r.value),
    }))
  );

  // Ticket payments, scoped exactly like the Tickets tab.
  const ticketing = event.ticketing_enabled
    ? await Promise.all([getTicketingSummary(eventId, assemblyId), listCollected(eventId, assemblyId), listDonations(eventId, assemblyId)])
    : null;
  const tickets = ticketing && ticketing[0].fieldLabel ? { summary: ticketing[0], collected: ticketing[1], donations: ticketing[2] } : null;

  const cloneRows = await Promise.all(
    clones.map(async (c) => ({
      clone: c,
      stats: await getAssemblyStats(eventId, c.id),
      tickets: tickets ? (await getTicketingSummary(eventId, c.id)).totals : null,
    }))
  );

  return { event, cloneName: clone?.name ?? null, stats, adults, children, questionReports, tickets, clones: cloneRows };
}

export type ReportData = Awaited<ReturnType<typeof getReportData>>;
