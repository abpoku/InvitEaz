import { requireAssemblyScope } from "@/lib/session";
import { listInviteeFields } from "@/lib/models/invitee-fields";
import { getEventById } from "@/lib/models/events";
import { csvEscape } from "@/lib/utils";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return new Response(access.message, { status: access.status });

  const event = await getEventById(params.id);
  if (!event) return new Response("Event not found.", { status: 404 });

  const fields = (await listInviteeFields(params.id)).filter((f) => f.active);
  const nameHeaders = event.invitee_name_format === "full" ? ["Full Name"] : ["First Name", "Last Name"];
  const hasGroup = fields.some((f) => f.key === "group");
  const headers = [...nameHeaders, ...fields.map((f) => f.label), ...(hasGroup ? ["Group Leader"] : [])];

  const sampleRow: string[] = nameHeaders.map((h) => (h === "Full Name" ? "Maria Garcia" : h === "First Name" ? "Maria" : "Garcia"));
  for (const f of fields) {
    if (f.key === "email") sampleRow.push("maria@example.com");
    else if (f.key === "phone") sampleRow.push("555-0100");
    else if (f.key === "group") sampleRow.push("Garcia Family");
    else if (f.key === "is_adult") sampleRow.push("Adult");
    else if (f.key === "plus_one_policy") sampleRow.push("");
    else if (f.field_type === "dropdown" && f.options_json) {
      const options: string[] = JSON.parse(f.options_json);
      sampleRow.push(options[0] || "");
    } else sampleRow.push("");
  }
  if (hasGroup) sampleRow.push("Yes");

  const csv = [headers.map(csvEscape).join(","), sampleRow.map(csvEscape).join(",")].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="inviteaz-invitee-template.csv"`,
    },
  });
}
