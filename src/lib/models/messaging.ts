import { listInvitees, listGroups } from "@/lib/models/invitees";
import { getAssembly } from "@/lib/models/assemblies";
import { appUrl } from "@/lib/email";
import { toE164 } from "@/lib/phone-text";
import { fullName } from "@/lib/utils";

export type Audience =
  | "everyone" | "attending" | "maybe" | "declined" | "no_response" | "adults" | "children" | "group" | "assembly" | "selected";

type InviteeWithStatus = Awaited<ReturnType<typeof listInvitees>>[number];

export class AudienceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** Who a Messages-tab send goes to. The one place this is decided, shared by email sends, the
 * "this will email N people" preview, and "Text from my phone" — so they can never disagree.
 * Statuses come from listInvitees, i.e. each person's latest response. Never falls back to a
 * broader audience: "Specific group" with no group chosen is an error, not "everyone". */
export async function resolveAudience(
  eventId: string,
  scopeAssemblyId: string | null,
  body: { audience?: string; groupId?: string; assemblyId?: string; inviteeIds?: unknown }
): Promise<{ invitees: InviteeWithStatus[]; assemblyId: string | null; audience: Audience }> {
  const audience = (body.audience || "everyone") as Audience;
  const known: Audience[] = ["everyone", "attending", "maybe", "declined", "no_response", "adults", "children", "group", "assembly", "selected"];
  if (!known.includes(audience)) throw new AudienceError("Choose who to send this to.");

  // A clone-scoped planner is always confined to their own clone; a full-scope planner may target one.
  let assemblyId = scopeAssemblyId;
  if (!assemblyId && audience === "assembly") {
    if (!body.assemblyId) throw new AudienceError("Choose a clone to message.");
    const assembly = await getAssembly(body.assemblyId);
    if (!assembly || assembly.event_id !== eventId) throw new AudienceError("Clone not found.", 404);
    assemblyId = assembly.id;
  }

  let invitees = await listInvitees(eventId, assemblyId);
  switch (audience) {
    case "attending": invitees = invitees.filter((i) => i.status === "attending"); break;
    case "maybe": invitees = invitees.filter((i) => i.status === "maybe"); break;
    case "declined": invitees = invitees.filter((i) => i.status === "declined"); break;
    // "No response" means exactly that — someone who said Maybe has responded.
    case "no_response": invitees = invitees.filter((i) => !["attending", "declined", "maybe"].includes(i.status)); break;
    case "adults": invitees = invitees.filter((i) => i.is_adult); break;
    case "children": invitees = invitees.filter((i) => !i.is_adult); break;
    case "group":
      if (!body.groupId) throw new AudienceError("Choose a group to message.");
      invitees = invitees.filter((i) => i.group_id === body.groupId);
      break;
    case "selected": {
      const ids = Array.isArray(body.inviteeIds) ? new Set(body.inviteeIds as string[]) : null;
      if (!ids || ids.size === 0) throw new AudienceError("Choose who to message.");
      invitees = invitees.filter((i) => ids.has(i.id));
      break;
    }
  }
  return { invitees, assemblyId, audience };
}

export interface PhoneTextRecipient {
  key: string;              // invitee id, or "group:<id>" for a household text
  kind: "invitee" | "group";
  name: string;             // who the text is addressed to
  firstName: string;
  householdName?: string;   // for a household text
  phone: string;            // E.164, ready for an sms: link
  link: string;             // their personal RSVP link, or the household's group link
}

/** The checklist behind "Text from my phone": one entry per person with a usable phone number — or,
 * with `perHousehold`, one per household (sent to the group leader if they have a phone, otherwise
 * the first member who does) carrying the group's link, plus one per person not in a group. */
export async function phoneTextRecipients(
  eventId: string,
  invitees: InviteeWithStatus[],
  perHousehold: boolean
): Promise<{ recipients: PhoneTextRecipient[]; skipped: { name: string; reason: string }[] }> {
  const recipients: PhoneTextRecipient[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const personal = (i: InviteeWithStatus): PhoneTextRecipient | null => {
    const phone = i.phone ? toE164(i.phone) : null;
    if (!phone) {
      skipped.push({ name: fullName(i.first_name, i.last_name), reason: i.phone ? "phone number isn't usable" : "no phone number" });
      return null;
    }
    return { key: i.id, kind: "invitee", name: fullName(i.first_name, i.last_name), firstName: i.first_name, phone, link: appUrl(`/r/${i.token}`) };
  };

  if (!perHousehold) {
    for (const i of invitees) { const r = personal(i); if (r) recipients.push(r); }
    return { recipients, skipped };
  }

  const groups = new Map((await listGroups(eventId)).map((g) => [g.id, g]));
  const byGroup = new Map<string, InviteeWithStatus[]>();
  for (const i of invitees) {
    if (i.group_id && groups.has(i.group_id)) byGroup.set(i.group_id, [...(byGroup.get(i.group_id) || []), i]);
    else { const r = personal(i); if (r) recipients.push(r); }
  }
  for (const [groupId, members] of byGroup) {
    const g = groups.get(groupId)!;
    const withPhone = members.filter((m) => m.phone && toE164(m.phone));
    const to = withPhone.find((m) => m.id === g.leader_invitee_id) || withPhone[0];
    if (!to) {
      skipped.push({ name: g.name, reason: "no one in this household has a usable phone number" });
      continue;
    }
    recipients.push({
      key: `group:${groupId}`, kind: "group", name: fullName(to.first_name, to.last_name), firstName: to.first_name,
      householdName: g.name, phone: toE164(to.phone!)!, link: appUrl(`/g/${g.rsvp_token}`),
    });
  }
  recipients.sort((a, b) => (a.householdName || a.name).localeCompare(b.householdName || b.name));
  return { recipients, skipped };
}
