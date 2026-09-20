import { requireAssemblyScope } from "@/lib/session";
import { listInvitees } from "@/lib/models/invitees";
import { listInviteeFields } from "@/lib/models/invitee-fields";
import { getEventById } from "@/lib/models/events";
import { appUrl } from "@/lib/email";
import { csvEscape } from "@/lib/utils";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return new Response(access.message, { status: access.status });

  const event = await getEventById(params.id);
  if (!event) return new Response("Event not found.", { status: 404 });

  const invitees = await listInvitees(params.id, access.assemblyId);
  const fields = (await listInviteeFields(params.id)).filter((f) => f.active);

  const nameHeaders = event.invitee_name_format === "full" ? ["Name"] : ["First Name", "Last Name"];
  const headers = [...nameHeaders, ...fields.map((f) => f.label), "RSVP Status", "RSVP Link"];
  const lines = [headers.join(",")];

  for (const i of invitees) {
    const custom = i.custom_fields ? JSON.parse(i.custom_fields) : {};
    const nameValues = event.invitee_name_format === "full" ? [i.first_name] : [i.first_name, i.last_name];
    const fieldValues = fields.map((f) => {
      switch (f.key) {
        case "email": return i.email;
        case "phone": return i.phone;
        case "group": return (i as any).group_name;
        case "is_adult": return i.is_adult ? "Adult" : "Child";
        case "plus_one_policy": return i.plus_one_policy || "";
        case "notes": return i.notes;
        default: return custom[f.key] || "";
      }
    });
    lines.push([
      ...nameValues.map(csvEscape), ...fieldValues.map(csvEscape),
      csvEscape((i as any).status), csvEscape(appUrl(`/r/${(i as any).token}`)),
    ].join(","));
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="invitees-${params.id}.csv"`,
    },
  });
}
