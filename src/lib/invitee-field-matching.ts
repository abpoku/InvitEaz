import type { InviteeNameFormat } from "@/lib/models/events";

/** Column-mapping + row-validation for invitee CSV/XLSX import. Pure functions with no Node-only
 * dependencies (no Buffer/fs), so this module is safe to import from both API routes and the
 * browser — the client re-validates instantly as a planner adjusts the column mapping, with no
 * extra round trip to the server needed. */

/** The minimal shape these functions need — deliberately not the full InviteeFieldRow so that
 * both the server's DB rows and the client's JSON-fetched field list satisfy it structurally. */
export interface InviteeFieldLike {
  key: string;
  label: string;
  kind: "core" | "custom";
  options_json: string | null;
  required: number;
  active: number;
}

export interface MappedInviteeRow {
  rowNumber: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  groupName: string;
  groupLeader: boolean;
  isAdult: boolean;
  plusOneAllowed: string;
  notes: string;
  customFields: Record<string, string>;
  errors: string[];
  isDuplicate?: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+()0-9\s.-]{7,20}$/;

function normalize(h: string): string {
  return h.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function coreAliases(field: InviteeFieldLike): string[] {
  switch (field.key) {
    case "email": return ["email", "e-mail", "email address"];
    case "phone": return ["phone", "phone number", "cell", "cell phone", "mobile", "telephone"];
    case "group": return ["group", "group name", "household", "household name"];
    case "is_adult": return ["adult/child", "adult / child", "adult or child", "age group"];
    case "plus_one_policy": return ["plus-one policy", "plus one policy", "plus-one allowed", "plus one allowed"];
    case "notes": return ["notes", "comments", "remarks"];
    default: return [];
  }
}

/** Best-guess mapping from raw file headers to field targets — "first_name" | "last_name" |
 * "full_name" | "group_leader" | a field.key, or absent when a header doesn't match anything. */
export function guessColumnMap(headers: string[], fields: InviteeFieldLike[], nameFormat: InviteeNameFormat): Record<string, string> {
  const alias = new Map<string, string>();

  if (nameFormat === "full") {
    for (const a of ["full name", "name", "guest name", "attendee name"]) alias.set(a, "full_name");
  } else {
    for (const a of ["first name", "firstname", "given name"]) alias.set(a, "first_name");
    for (const a of ["last name", "lastname", "surname"]) alias.set(a, "last_name");
  }
  alias.set("group leader", "group_leader");

  for (const field of fields) {
    if (!field.active) continue;
    const aliases = field.kind === "core" ? coreAliases(field) : [field.label.toLowerCase(), field.key.replace(/_/g, " ")];
    for (const a of aliases) alias.set(a, field.key);
    alias.set(field.label.toLowerCase(), field.key);
  }

  const map: Record<string, string> = {};
  for (const h of headers) {
    const target = alias.get(normalize(h));
    if (target) map[h] = target;
  }
  return map;
}

export function validateRecords(
  records: Record<string, any>[],
  columnMap: Record<string, string>,
  fields: InviteeFieldLike[],
  nameFormat: InviteeNameFormat
): MappedInviteeRow[] {
  const activeByKey = new Map(fields.filter((f) => f.active).map((f) => [f.key, f]));

  return records.map((raw, idx) => {
    const rowNumber = idx + 2; // account for header row
    let firstName = "", lastName = "", fullName = "", groupLeaderRaw = "";
    let email = "", phone = "", groupName = "", isAdultRaw = "", plusOneRaw = "", notes = "";
    const customFields: Record<string, string> = {};

    for (const [header, value] of Object.entries(raw)) {
      const target = columnMap[header];
      if (!target) continue;
      const v = String(value ?? "").trim();
      switch (target) {
        case "first_name": firstName = v; break;
        case "last_name": lastName = v; break;
        case "full_name": fullName = v; break;
        case "group_leader": groupLeaderRaw = v.toLowerCase(); break;
        case "email": email = v; break;
        case "phone": phone = v; break;
        case "group": groupName = v; break;
        case "is_adult": isAdultRaw = v.toLowerCase(); break;
        case "plus_one_policy": plusOneRaw = v.toLowerCase(); break;
        case "notes": notes = v; break;
        default: {
          const field = activeByKey.get(target);
          if (field && field.kind === "custom") customFields[target] = v;
        }
      }
    }

    if (nameFormat === "full" && fullName) firstName = fullName;

    const errors: string[] = [];
    if (!firstName) errors.push(nameFormat === "full" ? "Missing name" : "Missing first name");
    if (nameFormat === "first_last" && !lastName) errors.push("Missing last name");

    const emailActive = activeByKey.has("email");
    const phoneActive = activeByKey.has("phone");
    if (email && !EMAIL_RE.test(email)) errors.push("Invalid email address");
    if (phone && !PHONE_RE.test(phone)) errors.push("Invalid phone number");
    if ((emailActive || phoneActive) && !email && !phone) errors.push("Missing email address or phone number");

    for (const field of activeByKey.values()) {
      if (!field.required) continue;
      // is_adult/plus_one_policy always carry a sensible default ("Adult", "use event default"),
      // so "required" doesn't meaningfully apply to them.
      if (field.key === "is_adult" || field.key === "plus_one_policy") continue;
      let value = "";
      switch (field.key) {
        case "email": value = email; break;
        case "phone": value = phone; break;
        case "group": value = groupName; break;
        case "notes": value = notes; break;
        default: value = field.kind === "custom" ? customFields[field.key] || "" : "";
      }
      if (!value) errors.push(`Missing ${field.label}`);
    }

    let plusOneAllowed = "";
    if (plusOneRaw) {
      if (["none", "no", "0", "false"].includes(plusOneRaw)) plusOneAllowed = "none";
      else if (["one", "1", "yes", "true"].includes(plusOneRaw)) plusOneAllowed = "one";
      else if (["multiple", "many", "2+"].includes(plusOneRaw)) plusOneAllowed = "multiple";
    }

    return {
      rowNumber,
      firstName,
      lastName,
      email,
      phone,
      groupName,
      groupLeader: ["yes", "true", "1", "leader"].includes(groupLeaderRaw),
      isAdult: !["child", "no", "false", "0"].includes(isAdultRaw),
      plusOneAllowed,
      notes,
      customFields,
      errors,
    };
  });
}

export function findDuplicateRowNumbers(rows: MappedInviteeRow[]): Set<number> {
  const seen = new Map<string, number>();
  const dupes = new Set<number>();
  for (const r of rows) {
    const key = r.email ? `email:${r.email.toLowerCase()}` : `name:${r.firstName.toLowerCase()}|${r.lastName.toLowerCase()}`;
    if (seen.has(key)) {
      dupes.add(r.rowNumber);
      dupes.add(seen.get(key)!);
    } else {
      seen.set(key, r.rowNumber);
    }
  }
  return dupes;
}
