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

export interface FieldIssue {
  field: string; // "first_name" | "last_name" | "full_name" | a field.key
  type: "missing" | "invalid_format";
  message: string;
}

export interface ExistingInviteeLite {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
}

export type DuplicateMatch =
  | { source: "db"; matchField: "email" | "phone" | "name"; existingInviteeId: string }
  | { source: "file"; matchField: "email" | "phone" | "name"; otherRowNumber: number };

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
  issues: FieldIssue[];
  duplicate: DuplicateMatch | null;
}

export interface FieldIssueSummary {
  field: string;
  label: string;
  type: "missing" | "invalid_format";
  count: number;
  rowNumbers: number[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+()0-9\s.-]{7,20}$/;

function normalize(h: string): string {
  return h.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function normalizePhone(p: string): string {
  return p.replace(/\D+/g, "");
}

function fieldLabel(field: string, fields: InviteeFieldLike[]): string {
  if (field === "first_name") return "First name";
  if (field === "last_name") return "Last name";
  if (field === "full_name") return "Name";
  return fields.find((f) => f.key === field)?.label ?? field;
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

function buildRow(
  raw: Record<string, any>,
  rowNumber: number,
  columnMap: Record<string, string>,
  fields: InviteeFieldLike[],
  nameFormat: InviteeNameFormat
): MappedInviteeRow {
  const activeByKey = new Map(fields.filter((f) => f.active).map((f) => [f.key, f]));

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

  const issues: FieldIssue[] = [];
  if (!firstName) {
    if (nameFormat === "full") issues.push({ field: "full_name", type: "missing", message: "Missing name" });
    else issues.push({ field: "first_name", type: "missing", message: "Missing first name" });
  }
  if (nameFormat === "first_last" && !lastName) issues.push({ field: "last_name", type: "missing", message: "Missing last name" });

  const emailActive = activeByKey.has("email");
  const phoneActive = activeByKey.has("phone");
  if (email && !EMAIL_RE.test(email)) issues.push({ field: "email", type: "invalid_format", message: "Invalid email address" });
  if (phone && !PHONE_RE.test(phone)) issues.push({ field: "phone", type: "invalid_format", message: "Invalid phone number" });
  if ((emailActive || phoneActive) && !email && !phone) {
    // Either field fixes it, so count the row under both buckets in the per-field summary.
    issues.push({ field: "email", type: "missing", message: "Missing email address or phone number" });
    issues.push({ field: "phone", type: "missing", message: "Missing email address or phone number" });
  }

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
    if (!value) issues.push({ field: field.key, type: "missing", message: `Missing ${field.label}` });
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
    issues,
    duplicate: null,
  };
}

export function validateRecords(
  records: Record<string, any>[],
  columnMap: Record<string, string>,
  fields: InviteeFieldLike[],
  nameFormat: InviteeNameFormat
): MappedInviteeRow[] {
  return records.map((raw, idx) => buildRow(raw, idx + 2, columnMap, fields, nameFormat)); // +2 accounts for header row
}

/** Re-runs the same issue rules directly against an already-mapped row's current values — used
 * after an inline edit (the "fix" step) or a bulk-edit apply, where there's no raw CSV
 * record/columnMap to re-run buildRow against. */
export function revalidateIssues(row: MappedInviteeRow, fields: InviteeFieldLike[], nameFormat: InviteeNameFormat): FieldIssue[] {
  const activeByKey = new Map(fields.filter((f) => f.active).map((f) => [f.key, f]));
  const issues: FieldIssue[] = [];

  if (!row.firstName) {
    if (nameFormat === "full") issues.push({ field: "full_name", type: "missing", message: "Missing name" });
    else issues.push({ field: "first_name", type: "missing", message: "Missing first name" });
  }
  if (nameFormat === "first_last" && !row.lastName) issues.push({ field: "last_name", type: "missing", message: "Missing last name" });

  const emailActive = activeByKey.has("email");
  const phoneActive = activeByKey.has("phone");
  if (row.email && !EMAIL_RE.test(row.email)) issues.push({ field: "email", type: "invalid_format", message: "Invalid email address" });
  if (row.phone && !PHONE_RE.test(row.phone)) issues.push({ field: "phone", type: "invalid_format", message: "Invalid phone number" });
  if ((emailActive || phoneActive) && !row.email && !row.phone) {
    issues.push({ field: "email", type: "missing", message: "Missing email address or phone number" });
    issues.push({ field: "phone", type: "missing", message: "Missing email address or phone number" });
  }

  for (const field of activeByKey.values()) {
    if (!field.required) continue;
    if (field.key === "is_adult" || field.key === "plus_one_policy") continue;
    let value = "";
    switch (field.key) {
      case "email": value = row.email; break;
      case "phone": value = row.phone; break;
      case "group": value = row.groupName; break;
      case "notes": value = row.notes; break;
      default: value = field.kind === "custom" ? row.customFields[field.key] || "" : "";
    }
    if (!value) issues.push({ field: field.key, type: "missing", message: `Missing ${field.label}` });
  }

  return issues;
}

/** Duplicate detection across two sources: invitees already in the database (whole event, so a
 * match sitting in a different assembly than the one being imported into is still caught), and
 * other rows within the same uploaded batch. Per row, a DB match always wins over a file match —
 * priority within each source is email -> phone -> name. */
export function findDuplicates(rows: MappedInviteeRow[], existing: ExistingInviteeLite[]): Map<number, DuplicateMatch> {
  const byEmail = new Map<string, string>();
  const byPhone = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const e of existing) {
    if (e.email) byEmail.set(e.email.toLowerCase(), e.id);
    if (e.phone) byPhone.set(normalizePhone(e.phone), e.id);
    byName.set(`${e.firstName.toLowerCase()}|${e.lastName.toLowerCase()}`, e.id);
  }

  const result = new Map<number, DuplicateMatch>();
  const unmatched: MappedInviteeRow[] = [];

  for (const r of rows) {
    const emailId = r.email ? byEmail.get(r.email.toLowerCase()) : undefined;
    const phoneId = r.phone ? byPhone.get(normalizePhone(r.phone)) : undefined;
    const nameId = byName.get(`${r.firstName.toLowerCase()}|${r.lastName.toLowerCase()}`);
    if (emailId) result.set(r.rowNumber, { source: "db", matchField: "email", existingInviteeId: emailId });
    else if (phoneId) result.set(r.rowNumber, { source: "db", matchField: "phone", existingInviteeId: phoneId });
    else if (nameId) result.set(r.rowNumber, { source: "db", matchField: "name", existingInviteeId: nameId });
    else unmatched.push(r);
  }

  const seenEmail = new Map<string, number>();
  const seenPhone = new Map<string, number>();
  const seenName = new Map<string, number>();
  for (const r of unmatched) {
    const emailKey = r.email ? r.email.toLowerCase() : null;
    const phoneKey = r.phone ? normalizePhone(r.phone) : null;
    const nameKey = `${r.firstName.toLowerCase()}|${r.lastName.toLowerCase()}`;

    const emailOther = emailKey ? seenEmail.get(emailKey) : undefined;
    const phoneOther = phoneKey ? seenPhone.get(phoneKey) : undefined;
    const nameOther = seenName.get(nameKey);

    if (emailOther !== undefined) {
      result.set(r.rowNumber, { source: "file", matchField: "email", otherRowNumber: emailOther });
      result.set(emailOther, { source: "file", matchField: "email", otherRowNumber: r.rowNumber });
    } else if (phoneOther !== undefined) {
      result.set(r.rowNumber, { source: "file", matchField: "phone", otherRowNumber: phoneOther });
      result.set(phoneOther, { source: "file", matchField: "phone", otherRowNumber: r.rowNumber });
    } else if (nameOther !== undefined) {
      result.set(r.rowNumber, { source: "file", matchField: "name", otherRowNumber: nameOther });
      result.set(nameOther, { source: "file", matchField: "name", otherRowNumber: r.rowNumber });
    } else {
      if (emailKey) seenEmail.set(emailKey, r.rowNumber);
      if (phoneKey) seenPhone.set(phoneKey, r.rowNumber);
      seenName.set(nameKey, r.rowNumber);
    }
  }

  return result;
}

/** Flattens every row's issues into per-field counts for the "N of M rows missing X" summary
 * banner, sorted with the most common issue first. */
export function fieldIssueSummary(rows: MappedInviteeRow[], fields: InviteeFieldLike[], nameFormat: InviteeNameFormat): FieldIssueSummary[] {
  void nameFormat; // labels are resolved per-issue via fieldLabel(), independent of nameFormat itself
  const byKey = new Map<string, FieldIssueSummary>();
  for (const row of rows) {
    for (const issue of row.issues) {
      const key = `${issue.field}:${issue.type}`;
      let entry = byKey.get(key);
      if (!entry) {
        entry = { field: issue.field, label: fieldLabel(issue.field, fields), type: issue.type, count: 0, rowNumbers: [] };
        byKey.set(key, entry);
      }
      entry.count += 1;
      entry.rowNumbers.push(row.rowNumber);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.count - a.count);
}
