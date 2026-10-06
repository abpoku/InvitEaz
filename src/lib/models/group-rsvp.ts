import { query } from "@/lib/db";
import {
  getGroupByRsvpToken, createInvitee, createInvitationFor, updateInvitee, deactivateInvitee,
  markInvitationOpened, countActiveInvitees, type GroupRow, type InviteeRow,
} from "@/lib/models/invitees";
import { getEventById, computeEffectiveStatus, logAudit, type EventRow } from "@/lib/models/events";
import { listQuestions, submitResponse, getAnswersForResponse, type QuestionRow } from "@/lib/models/rsvp";
import { listInviteeFields, type InviteeFieldRow } from "@/lib/models/invitee-fields";
import { getUserById, PLAN_LIMITS } from "@/lib/models/users";
import { getGroupTicketBalance } from "@/lib/models/ticketing";
import { groupExtraGuests } from "@/lib/guest-allowance";
import { donationNoteFor } from "@/lib/donation-note";
import { isPastDeadline, fullName } from "@/lib/utils";

/** The household-level RSVP link (/g/[token]) — one link per group that lets whoever opens it
 * RSVP for every member at once. Unlike the old "first member to open their own link RSVPs for
 * the household" simplification (see CLAUDE.md), every member gets their *own* response row on
 * their *own* invitation here, so per-person status, answers, and headcount are all exact. */

export class GroupRsvpError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

// Fields a guest may never set from the group link: the group itself (they're already in one),
// the planner-only per-invitee plus-one override, and the ticketing tier (prices are planner-managed).
const PLANNER_ONLY_FIELD_KEYS = new Set(["group", "plus_one_policy"]);

export function guestEditableFields(fields: InviteeFieldRow[], event: EventRow): InviteeFieldRow[] {
  return fields.filter(
    (f) => f.active && f.collect_at_signup && !PLANNER_ONLY_FIELD_KEYS.has(f.key) && f.id !== event.ticket_field_id
  );
}

interface MemberRow extends InviteeRow {
  invitation_id: string | null;
  response_id: string | null;
  rsvp_status: "attending" | "declined" | "maybe" | null;
  responder_name: string | null;
  responder_email: string | null;
  responder_phone: string | null;
  responded_at: string | null;
}

async function listGroupMembersWithResponses(groupId: string): Promise<MemberRow[]> {
  // Planner's own members first (in the order they were added), then anyone a guest added.
  return query<MemberRow>(
    `SELECT iv.*, i.id as invitation_id,
       r.id as response_id, r.rsvp_status, r.responder_name, r.responder_email, r.responder_phone, r.responded_at
     FROM invitees iv
     LEFT JOIN invitations i ON i.id = (
       SELECT i2.id FROM invitations i2 WHERE i2.invitee_id = iv.id ORDER BY i2.created_at ASC LIMIT 1
     )
     LEFT JOIN rsvp_responses r ON r.id = (
       SELECT r2.id FROM rsvp_responses r2 WHERE r2.invitation_id = i.id ORDER BY r2.responded_at DESC LIMIT 1
     )
     WHERE iv.group_id = ? AND iv.active = 1
     ORDER BY iv.added_by_guest ASC, iv.created_at ASC`,
    [groupId]
  );
}

/** Never trust custom_fields to be a JSON object — see "malformed JSON" in CLAUDE.md. */
function parseCustomFields(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** One member's current value for each guest-editable field, keyed by field key — core fields
 * come from their dedicated invitee columns, custom fields from custom_fields. */
function fieldValuesFor(member: InviteeRow, fields: InviteeFieldRow[]): Record<string, string> {
  const custom = parseCustomFields(member.custom_fields);
  const out: Record<string, string> = {};
  for (const f of fields) {
    if (f.key === "email") out[f.key] = member.email || "";
    else if (f.key === "phone") out[f.key] = member.phone || "";
    else if (f.key === "notes") out[f.key] = member.notes || "";
    else if (f.key === "is_adult") out[f.key] = member.is_adult ? "adult" : "child";
    else out[f.key] = custom[f.key] != null ? String(custom[f.key]) : "";
  }
  return out;
}

function isLocked(event: EventRow): boolean {
  if (event.status === "cancelled") return false;
  const status = computeEffectiveStatus(event);
  const reopened = !!event.rsvp_reopened && status !== "completed";
  return (status === "rsvp_closed" && !reopened) || status === "completed";
}

async function resolve(token: string): Promise<{ group: GroupRow; event: EventRow }> {
  const group = await getGroupByRsvpToken(token);
  if (!group) throw new GroupRsvpError("This invitation link isn't valid.", 404);
  const event = await getEventById(group.event_id);
  if (!event) throw new GroupRsvpError("This event no longer exists.", 404);
  return { group, event };
}

export async function loadGroupInvitation(token: string) {
  const { group, event } = await resolve(token);
  const [members, questions, allFields, tickets] = await Promise.all([
    listGroupMembersWithResponses(group.id),
    listQuestions(event.id),
    listInviteeFields(event.id),
    getGroupTicketBalance(event.id, group.id),
  ]);
  const fields = guestEditableFields(allFields, event);

  // Opening the household link counts as every member having opened their invitation.
  await Promise.all(members.filter((m) => m.invitation_id).map((m) => markInvitationOpened(m.invitation_id!)));

  const answersByMember = await Promise.all(members.map((m) => (m.response_id ? getAnswersForResponse(m.response_id) : [])));
  const latest = members.filter((m) => m.responded_at).sort((a, b) => (b.responded_at! > a.responded_at! ? 1 : -1))[0];

  const plannerMembers = members.filter((m) => !m.added_by_guest);
  return {
    event: { ...event, effective_status: computeEffectiveStatus(event) },
    group: { id: group.id, name: group.name },
    members: members.map((m, idx) => ({
      id: m.id,
      first_name: m.first_name,
      last_name: m.last_name,
      added_by_guest: !!m.added_by_guest,
      rsvp_status: m.rsvp_status,
      fieldValues: fieldValuesFor(m, fields),
      answers: answersByMember[idx],
    })),
    questions,
    fields,
    allowance: {
      extraGuests: groupExtraGuests(event, plannerMembers),
      guestsAdded: members.length - plannerMembers.length,
    },
    responder: latest
      ? { name: latest.responder_name || "", email: latest.responder_email || "", phone: latest.responder_phone || "" }
      : null,
    tickets,
    donationNote: donationNoteFor(event),
    locked: isLocked(event),
  };
}

export interface GroupMemberSubmission {
  inviteeId?: string; // omitted for a guest being added from the link
  firstName: string;
  lastName: string;
  attending: boolean;
  fieldValues?: Record<string, string>;
  answers?: { questionId: string; value: string }[];
}

export interface GroupSubmission {
  responder: { name: string; email?: string; phone?: string };
  members: GroupMemberSubmission[];
  removeInviteeIds?: string[]; // only guests previously added from this link may be removed
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function visibleCustomQuestions(questions: QuestionRow[], attending: boolean): QuestionRow[] {
  return questions.filter(
    (q) => q.kind === "custom" && q.active &&
      (!q.show_if_attending || (attending && q.show_if_attending === "yes") || (!attending && q.show_if_attending === "no"))
  );
}

export async function submitGroupResponse(token: string, input: GroupSubmission) {
  const { group, event } = await resolve(token);
  if (event.status === "cancelled") throw new GroupRsvpError("This event has been cancelled.");
  if (isLocked(event)) throw new GroupRsvpError("RSVPs for this event are closed.");

  const [members, questions, allFields] = await Promise.all([
    listGroupMembersWithResponses(group.id),
    listQuestions(event.id),
    listInviteeFields(event.id),
  ]);
  const fields = guestEditableFields(allFields, event);
  const byId = new Map(members.map((m) => [m.id, m]));
  const fullNameFormat = event.invitee_name_format === "full";

  // ---- Validate everything before writing anything ----
  const responderName = (input.responder?.name || "").trim();
  const responderEmail = (input.responder?.email || "").trim();
  const responderPhone = (input.responder?.phone || "").trim();
  if (!responderName) throw new GroupRsvpError("Please add your name.");
  const emailQ = questions.find((q) => q.key === "email");
  const phoneQ = questions.find((q) => q.key === "phone");
  if (emailQ?.active && emailQ.required && !responderEmail) throw new GroupRsvpError("Please add your email.");
  if (phoneQ?.active && phoneQ.required && !responderPhone) throw new GroupRsvpError("Please add your phone number.");
  if (responderEmail && !EMAIL_RE.test(responderEmail)) throw new GroupRsvpError("Please enter a valid email address.");

  const removeIds = new Set(input.removeInviteeIds || []);
  for (const id of removeIds) {
    const m = byId.get(id);
    if (!m || !m.added_by_guest) throw new GroupRsvpError("Only guests added from this link can be removed here.");
  }

  const submitted = Array.isArray(input.members) ? input.members : [];
  const seen = new Set<string>();
  for (const s of submitted) {
    if (!s.inviteeId) continue;
    if (!byId.has(s.inviteeId) || seen.has(s.inviteeId)) {
      throw new GroupRsvpError("Your group has changed since this page was opened. Please reload and try again.", 409);
    }
    seen.add(s.inviteeId);
  }
  // Every current member must be answered for (or, for a guest-added one, removed) — otherwise a
  // stale tab could silently skip someone the planner added in the meantime.
  for (const m of members) {
    if (!seen.has(m.id) && !removeIds.has(m.id)) {
      throw new GroupRsvpError("Your group has changed since this page was opened. Please reload and try again.", 409);
    }
  }
  if ([...seen].some((id) => removeIds.has(id))) throw new GroupRsvpError("A guest can't be both kept and removed.");

  const additions = submitted.filter((s) => !s.inviteeId);
  if (additions.length > 0 || removeIds.size > 0) {
    const plannerMembers = members.filter((m) => !m.added_by_guest);
    const allowed = groupExtraGuests(event, plannerMembers);
    const guestsAfter = members.filter((m) => m.added_by_guest && !removeIds.has(m.id)).length + additions.length;
    if (additions.length > 0 && guestsAfter > allowed) {
      throw new GroupRsvpError(
        allowed === 0
          ? "This invitation doesn't include additional guests."
          : `This invitation includes up to ${allowed} additional guest${allowed === 1 ? "" : "s"}.`
      );
    }
    if (additions.length > 0) {
      const owner = await getUserById(event.owner_id);
      const limit = owner ? PLAN_LIMITS[owner.plan].inviteesPerEvent : Infinity;
      if ((await countActiveInvitees(event.id)) - removeIds.size + additions.length > limit) {
        throw new GroupRsvpError("This event's guest list is full. Please contact the organizer to add more guests.");
      }
    }
  }

  const normalized = submitted.map((s) => {
    const firstName = (s.firstName || "").trim();
    // Single-full-name events store last_name = "" — must pass through as "", never null (NOT NULL).
    const lastName = fullNameFormat ? "" : (s.lastName || "").trim();
    const label = firstName || "each guest";
    if (!firstName) throw new GroupRsvpError("Please add a name for every guest.");
    if (typeof s.attending !== "boolean") throw new GroupRsvpError(`Please choose whether ${label} will attend.`);

    const values: Record<string, string> = {};
    for (const f of fields) {
      const v = s.fieldValues && typeof s.fieldValues[f.key] === "string" ? s.fieldValues[f.key].trim() : "";
      if (f.required && !v) throw new GroupRsvpError(`Please fill in ${f.label} for ${label}.`);
      if (f.key === "email" && v && !EMAIL_RE.test(v)) throw new GroupRsvpError(`Please enter a valid email for ${label}.`);
      values[f.key] = v;
    }

    const visible = visibleCustomQuestions(questions, s.attending);
    const given = new Map((Array.isArray(s.answers) ? s.answers : []).map((a) => [a.questionId, String(a.value ?? "")]));
    const answers = visible.map((q) => ({ questionId: q.id, value: given.get(q.id) || "" }));
    for (const q of visible) {
      if (q.required && !given.get(q.id)) throw new GroupRsvpError(`Please answer "${q.label}" for ${label}.`);
    }
    return { ...s, firstName, lastName, values, answers };
  });

  // ---- Write ----
  const reopenedAfterDeadline = isPastDeadline(event.rsvp_deadline) && !!event.rsvp_reopened;
  const respond = (invitationId: string, attending: boolean, answers: { questionId: string; value: string }[]) =>
    submitResponse({
      invitationId, eventId: event.id, attending, numAttending: attending ? 1 : 0, guestNames: [],
      responderName, responderEmail: responderEmail || undefined, responderPhone: responderPhone || undefined,
      answers, reopenedAfterDeadline,
    });

  let attendingCount = 0;
  for (const s of normalized) {
    if (s.attending) attendingCount += 1;
    if (s.inviteeId) {
      const member = byId.get(s.inviteeId)!;
      const patch: Partial<InviteeRow> = { first_name: s.firstName, last_name: s.lastName };
      const custom = parseCustomFields(member.custom_fields);
      let customChanged = false;
      for (const f of fields) {
        const v = s.values[f.key];
        if (f.key === "email") patch.email = v || null;
        else if (f.key === "phone") patch.phone = v || null;
        else if (f.key === "notes") patch.notes = v || null;
        else if (f.key === "is_adult") patch.is_adult = v === "child" ? 0 : 1;
        else {
          // Only keys the guest was actually shown are touched — every other custom field survives.
          if (v) custom[f.key] = v; else delete custom[f.key];
          customChanged = true;
        }
      }
      if (customChanged) patch.custom_fields = Object.keys(custom).length ? JSON.stringify(custom) : null;
      await updateInvitee(member.id, patch);
      const invitationId = member.invitation_id || (await createInvitationFor(event.id, member.id)).id;
      await respond(invitationId, s.attending, s.answers);
    } else {
      const custom: Record<string, string> = {};
      for (const f of fields) {
        if (!["email", "phone", "notes", "is_adult"].includes(f.key) && s.values[f.key]) custom[f.key] = s.values[f.key];
      }
      const { invitation } = await createInvitee(event.id, {
        firstName: s.firstName,
        lastName: s.lastName,
        email: s.values.email || undefined,
        phone: s.values.phone || undefined,
        notes: s.values.notes || undefined,
        isAdult: s.values.is_adult !== "child",
        groupId: group.id,
        assemblyId: group.assembly_id,
        customFields: custom,
        addedByGuest: true,
      });
      await respond(invitation.id, s.attending, s.answers);
    }
  }
  for (const id of removeIds) await deactivateInvitee(id);

  const summary = [
    `${attendingCount} attending, ${normalized.length - attendingCount} not attending`,
    additions.length ? `added ${additions.map((a) => fullName(a.firstName, a.lastName)).join(", ")}` : "",
    removeIds.size ? `removed ${[...removeIds].map((id) => fullName(byId.get(id)!.first_name, byId.get(id)!.last_name)).join(", ")}` : "",
  ].filter(Boolean).join("; ");
  await logAudit(event.id, `${responderName} (group link)`, "group_rsvp.submitted", `${group.name}: ${summary}`);

  return { event, group, attendingCount, responderName, responderEmail };
}
