import { randomBytes, randomUUID } from "crypto";
import clsx, { ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

/** Cryptographically random, non-sequential, non-guessable invitation token. */
export function newInviteToken(): string {
  return randomBytes(9).toString("base64url");
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

export async function uniqueSlug(
  base: string,
  exists: (candidate: string) => boolean
): Promise<string> {
  let slug = slugify(base) || "event";
  let n = 1;
  while (exists(slug)) {
    n += 1;
    slug = `${slugify(base)}-${n}`;
  }
  return slug;
}

/** Default RSVP deadline: 24 hours before event start. */
export function defaultRsvpDeadline(eventDate: string, eventTime: string): string {
  const dt = new Date(`${eventDate}T${eventTime}:00`);
  dt.setHours(dt.getHours() - 24);
  return dt.toISOString();
}

export function eventStartDateTime(eventDate: string, eventTime: string): Date {
  return new Date(`${eventDate}T${eventTime}:00`);
}

export function isPastDeadline(rsvpDeadline: string | null): boolean {
  if (!rsvpDeadline) return false;
  return new Date() > new Date(rsvpDeadline);
}

export function formatDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

export function formatDateShort(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function initials(first: string, last: string): string {
  return `${(first || "?")[0] ?? ""}${(last || "")[0] ?? ""}`.toUpperCase();
}

/** Joins first/last name parts, tolerating an empty last name (events using "full name" mode
 * store the whole name in first_name and leave last_name blank). */
export function fullName(first: string, last: string): string {
  return [first, last].filter(Boolean).join(" ");
}

/** Quotes a CSV field if it contains a comma, quote, or newline, doubling any internal quotes. */
export function csvEscape(v: any): string {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Formats integer cents as this app's single fixed-currency display string, e.g. 4250 -> "$42.50".
 * New as of the ticketing feature — every monetary value in this app is stored as integer cents
 * (no floats, no per-event currency setting). */
/** Whole numbers with thousands separators: 3330 → "3,330". */
export function formatNumber(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** Cents → "$3,330.00" (thousands separators, always two decimals). */
export function formatCurrency(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Inverse of formatCurrency for form inputs — parses a planner-typed dollar string ("42.5",
 * "$42.50") into integer cents, rounding to avoid float drift. Returns 0 for empty/invalid input. */
export function dollarsToCents(input: string): number {
  const n = parseFloat(input.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
