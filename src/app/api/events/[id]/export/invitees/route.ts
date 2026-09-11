import { requireEventRole } from "@/lib/session";
import { listInvitees } from "@/lib/models/invitees";
import { appUrl } from "@/lib/email";

function csvEscape(v: any): string {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const access = await requireEventRole(params.id, "viewer");
  if (!access.ok) return new Response(access.message, { status: access.status });

  const invitees = listInvitees(params.id);
  const headers = ["First Name", "Last Name", "Email", "Phone", "Group", "Adult/Child", "Plus-One Policy", "RSVP Status", "RSVP Link", "Notes"];
  const lines = [headers.join(",")];
  for (const i of invitees) {
    lines.push([
      csvEscape(i.first_name), csvEscape(i.last_name), csvEscape(i.email), csvEscape(i.phone),
      csvEscape(i.group_name), csvEscape(i.is_adult ? "Adult" : "Child"), csvEscape(i.plus_one_policy || ""),
      csvEscape(i.status), csvEscape(appUrl(`/r/${i.token}`)), csvEscape(i.notes),
    ].join(","));
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="invitees-${params.id}.csv"`,
    },
  });
}
