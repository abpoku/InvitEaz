import Papa from "papaparse";
import * as XLSX from "xlsx";

export interface ParsedRow {
  rowNumber: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  groupName: string;
  groupLeader: boolean;
  isAdult: boolean;
  plusOneAllowed: string; // "none" | "one" | "multiple" | ""
  notes: string;
  errors: string[];
}

const HEADER_ALIASES: Record<string, string> = {
  "first name": "firstName",
  firstname: "firstName",
  "last name": "lastName",
  lastname: "lastName",
  email: "email",
  "email address": "email",
  phone: "phone",
  "phone number": "phone",
  "group name": "groupName",
  group: "groupName",
  "group leader": "groupLeader",
  "adult/child": "isAdult",
  "adult / child": "isAdult",
  "plus-one allowed": "plusOneAllowed",
  "plus one allowed": "plusOneAllowed",
  notes: "notes",
};

function normalizeHeader(h: string): string {
  return HEADER_ALIASES[h.trim().toLowerCase()] || h.trim();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+()0-9\s.-]{7,20}$/;

export function parseInviteeFile(buffer: Buffer, filename: string): { rows: ParsedRow[]; parseError: string | null } {
  const isXlsx = /\.xlsx?$/i.test(filename);
  let records: Record<string, any>[] = [];
  let parseError: string | null = null;

  try {
    if (isXlsx) {
      const wb = XLSX.read(buffer, { type: "buffer" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      records = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    } else {
      const text = buffer.toString("utf-8");
      const result = Papa.parse(text, { header: true, skipEmptyLines: true });
      records = result.data as Record<string, any>[];
    }
  } catch (e: any) {
    return { rows: [], parseError: "We couldn't read that file. Make sure it's a valid CSV or XLSX export." };
  }

  if (records.length === 0) {
    return { rows: [], parseError: "No records found in that file." };
  }

  // normalize headers on first record's keys
  const rows: ParsedRow[] = records.map((raw, idx) => {
    const rec: Record<string, any> = {};
    for (const key of Object.keys(raw)) {
      rec[normalizeHeader(key)] = raw[key];
    }
    const errors: string[] = [];
    const firstName = String(rec.firstName ?? "").trim();
    const lastName = String(rec.lastName ?? "").trim();
    const email = String(rec.email ?? "").trim();
    const phone = String(rec.phone ?? "").trim();
    const groupName = String(rec.groupName ?? "").trim();
    const groupLeaderRaw = String(rec.groupLeader ?? "").trim().toLowerCase();
    const isAdultRaw = String(rec.isAdult ?? "").trim().toLowerCase();
    const plusOneRaw = String(rec.plusOneAllowed ?? "").trim().toLowerCase();
    const notes = String(rec.notes ?? "").trim();

    if (!firstName) errors.push("Missing first name");
    if (!lastName) errors.push("Missing last name");
    if (email && !EMAIL_RE.test(email)) errors.push("Invalid email address");
    if (phone && !PHONE_RE.test(phone)) errors.push("Invalid phone number");
    if (!email && !phone) errors.push("Missing email address");

    let plusOneAllowed = "";
    if (plusOneRaw) {
      if (["none", "no", "0", "false"].includes(plusOneRaw)) plusOneAllowed = "none";
      else if (["one", "1", "yes", "true"].includes(plusOneRaw)) plusOneAllowed = "one";
      else if (["multiple", "many", "2+"].includes(plusOneRaw)) plusOneAllowed = "multiple";
    }

    return {
      rowNumber: idx + 2, // account for header row
      firstName,
      lastName,
      email,
      phone,
      groupName,
      groupLeader: ["yes", "true", "1", "leader"].includes(groupLeaderRaw),
      isAdult: !["child", "no", "false", "0"].includes(isAdultRaw),
      plusOneAllowed,
      notes,
      errors,
    };
  });

  return { rows, parseError: null };
}

export function findDuplicates(rows: ParsedRow[]): Set<number> {
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
