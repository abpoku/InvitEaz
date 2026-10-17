"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { StatusBadge } from "@/components/StatusBadge";
import { AddInviteeModal } from "@/components/invitees/AddInviteeModal";
import { UploadModal } from "@/components/invitees/UploadModal";
import { FieldsManagerModal } from "@/components/invitees/FieldsManagerModal";
import { BulkEditModal } from "@/components/invitees/BulkEditModal";
import { MergeGroupsModal } from "@/components/invitees/MergeGroupsModal";
import { ViewToggle } from "@/components/ViewToggle";
import { SortTh, useTableSort } from "@/components/SortableHeader";
import { KebabMenu, type KebabItem } from "@/components/KebabMenu";
import { MOBILE_DOCK, SortSelect, MobileListHeader, CardCheckbox } from "@/components/MobileList";
import { sortRows, statusRank, numericOrText, type SortValue } from "@/lib/table-sort";
import { fullName, formatNumber, cn } from "@/lib/utils";
import { STATUSES, STATUS_LABEL, StatusSegments, NoReplyNote, Breakdown, breakdownOf, PartySize, respondedText, type Status } from "@/components/invitees/RsvpControls";
import { toE164, personalize, smsHref, isAppleDevice } from "@/lib/phone-text";

// "Text from my phone" quick action: opens the planner's own Messages app with this ready to send.
const QUICK_TEXT = "Hi {first_name}, here's your RSVP link for {event}: {link}";
import { groupCounts } from "@/lib/bulk-select";
import type { InviteeFieldType } from "@/lib/models/invitee-fields";

export interface GroupRow { id: string; name: string; assembly_id: string | null; rsvp_token: string; leader_invitee_id: string | null; }

export interface InviteeField {
  id: string;
  key: string;
  label: string;
  kind: "core" | "custom";
  field_type: InviteeFieldType;
  options_json: string | null;
  required: number;
  collect_at_signup: number;
  order_index: number;
  active: number;
}

export interface Assembly { id: string; name: string; }

export interface InviteeRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  group_name: string | null;
  group_id: string | null;
  assembly_id: string | null;
  assembly_name: string | null;
  is_adult: number;
  plus_one_policy: string | null;
  notes: string | null;
  custom_fields: string | null;
  token: string;
  /** Latest response's status when they have one, else the invitation's (invited/opened/…). */
  status: string;
  added_by_guest: number;
  invitation_id: string | null;
  invitation_status: string | null;
  response_id: string | null;
  rsvp_status: Status | null;
  num_attending: number | null;
  responded_at: string | null;
  is_modification: number | null;
  recorded_by: string | null;
}

export interface RsvpQuestion { id: string; label: string; }
type AnswersByResponse = Record<string, { question_id: string; value: string | null }[]>;

/** What the server page loads up front (see invitees/page.tsx) — the same data load() fetches. */
export interface InviteesInitialData {
  invitees: InviteeRow[];
  fields: InviteeField[];
  assemblies: Assembly[];
  ticketFieldId: string | null;
  groups: GroupRow[];
  /** The event's custom RSVP questions and each latest response's answers — the RSVP columns. */
  questions: RsvpQuestion[];
  answers: AnswersByResponse;
}

/** Set-a-status controls for a bulk-action bar: the status, a party size when attending, and Apply. */
function BulkStatusControls({ status, onStatus, num, onNum, busy, applyLabel, onApply }: {
  status: Status; onStatus: (s: Status) => void;
  num: string; onNum: (n: string) => void;
  busy: boolean; applyLabel: string; onApply: () => void;
}) {
  return (
    <span className="flex items-center gap-2">
      <select aria-label="Set status to" className="input w-auto py-1 text-base sm:text-xs" value={status} onChange={(e) => onStatus(e.target.value as Status)}>
        {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
      </select>
      {status === "attending" && (
        <input type="number" min={1} aria-label="Party size" className="input w-16 py-1 text-base sm:text-xs" value={num} onChange={(e) => onNum(e.target.value)} />
      )}
      <button onClick={onApply} disabled={busy} className="text-sm font-medium text-wine-700 hover:underline disabled:opacity-50">{busy ? "Applying…" : applyLabel}</button>
    </span>
  );
}

/** The Export dropdown (desktop): the guest list and the RSVP responses as CSV. Closes on a pick, an
 * outside click or Escape. On phones these live in the toolbar's ⋮ menu instead. */
function ExportMenu({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const item = "block px-3.5 py-2 text-sm text-ink hover:bg-paper-soft";
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className="btn-ghost">Export ▾</button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 min-w-[200px] rounded-md border border-paper-line bg-paper py-1 shadow-lifted">
          <a role="menuitem" href={`/api/events/${eventId}/export/invitees`} download onClick={() => setOpen(false)} className={item}>Guest list (CSV)</a>
          <a role="menuitem" href={`/api/events/${eventId}/export/responses`} download onClick={() => setOpen(false)} className={item}>RSVP responses (CSV)</a>
        </div>
      )}
    </div>
  );
}

/** Which columns the list shows: who people are (fields, links) or how they've replied (party size,
 * answers, when). Everything else — rows, filters, selection, sort — is shared by both. */
type Columns = "details" | "rsvp";

function visibleFields(fields: InviteeField[]): InviteeField[] {
  return fields.filter((f) => f.active).sort((a, b) => a.order_index - b.order_index);
}

function fieldValue(field: InviteeField, i: InviteeRow): string {
  switch (field.key) {
    case "email": return i.email || "—";
    case "phone": return i.phone || "—";
    case "group": return i.group_name || "—";
    case "is_adult": return i.is_adult ? "Adult" : "Child";
    case "plus_one_policy": return i.plus_one_policy || "—";
    case "notes": return i.notes || "—";
    default: {
      const custom = i.custom_fields ? JSON.parse(i.custom_fields) : {};
      return custom[field.key] || "—";
    }
  }
}

/** What a field column sorts by: the raw value (empty sorts last), numerically for number fields and
 * any value that reads as a number, as plain text otherwise. */
function fieldSortValue(field: InviteeField, i: InviteeRow): SortValue {
  switch (field.key) {
    case "email": return i.email;
    case "phone": return i.phone;
    case "group": return i.group_name;
    case "is_adult": return i.is_adult ? "Adult" : "Child";
    case "plus_one_policy": return i.plus_one_policy;
    case "notes": return i.notes;
    default: {
      let custom: Record<string, unknown> = {};
      try {
        const parsed = i.custom_fields ? JSON.parse(i.custom_fields) : {};
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) custom = parsed;
      } catch {}
      const v = custom[field.key];
      return typeof v === "string" ? numericOrText(v) : typeof v === "number" ? v : null;
    }
  }
}

/** The server's error message for a failed write (e.g. a ticket limit refusing it), or null when it
 * succeeded. A crash returns an empty body, so never let parsing it throw. */
async function errorFrom(res: Response, fallback: string): Promise<string | null> {
  if (res.ok) return null;
  let data: any = {};
  try { data = await res.json(); } catch {}
  return data.error || fallback;
}

export function InviteesManager({ eventId, groupRsvpMode, nameFormat, eventName = "our event", initialData, canMutate }: {
  eventId: string;
  groupRsvpMode: string;
  nameFormat: "first_last" | "full";
  eventName?: string;
  initialData?: InviteesInitialData;
  /** False for viewers: the list is read-only (no selection, editing, status picks, add or upload). */
  canMutate: boolean;
}) {
  const router = useRouter();
  const [invitees, setInvitees] = useState<InviteeRow[]>(initialData?.invitees ?? []);
  const [fields, setFields] = useState<InviteeField[]>(visibleFields(initialData?.fields ?? []));
  const [assemblies, setAssemblies] = useState<Assembly[]>(initialData?.assemblies ?? []);
  const [groups, setGroups] = useState<GroupRow[]>(initialData?.groups ?? []);
  const [questions, setQuestions] = useState<RsvpQuestion[]>(initialData?.questions ?? []);
  const [answers, setAnswers] = useState<AnswersByResponse>(initialData?.answers ?? {});
  const [loading, setLoading] = useState(!initialData);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  // The clone filter lives in the URL (?clone=) — the same place Responses and Tickets keep theirs — so
  // the event header's numbers follow it (EventHeaderStats). Updated with history.replaceState, which
  // Next keeps in sync with useSearchParams without re-requesting the page.
  const searchParams = useSearchParams();
  const [assemblyFilter, setAssemblyFilterState] = useState(() => searchParams.get("clone") || "all");
  function setAssemblyFilter(value: string) {
    setAssemblyFilterState(value);
    const params = new URLSearchParams(window.location.search);
    if (value === "all") params.delete("clone"); else params.set("clone", value);
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }
  // Details | RSVP, also in the URL (?view=rsvp) so a refresh, or the old Responses link, lands on it.
  const [columns, setColumnsState] = useState<Columns>(() => (searchParams.get("view") === "rsvp" ? "rsvp" : "details"));
  function setColumns(value: Columns) {
    setColumnsState(value);
    const params = new URLSearchParams(window.location.search);
    if (value === "details") params.delete("view"); else params.set("view", value);
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }
  const rsvpView = columns === "rsvp";
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const [bulkStatus, setBulkStatus] = useState<Status>("attending");
  const [bulkNum, setBulkNum] = useState("1");
  const [bulkStatusBusy, setBulkStatusBusy] = useState(false);
  const [groupBulkStatus, setGroupBulkStatus] = useState<Status>("attending");
  const [groupBulkNum, setGroupBulkNum] = useState("1");
  const [groupBulkStatusBusy, setGroupBulkStatusBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<InviteeRow | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showFields, setShowFields] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [ticketFieldId, setTicketFieldId] = useState<string | null>(initialData?.ticketFieldId ?? null);
  const [tierBusyId, setTierBusyId] = useState<string | null>(null);
  const [view, setView] = useState<"individual" | "group">("individual");
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [groupError, setGroupError] = useState<string | null>(null);
  const [groupBusyId, setGroupBusyId] = useState<string | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [groupBulkBusy, setGroupBulkBusy] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());

  function toggleGroupExpanded(groupId: string) {
    setExpandedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [inviteesRes, fieldsRes, assembliesRes, ticketingRes, groupsRes] = await Promise.all([
        fetch(`/api/events/${eventId}/invitees`),
        fetch(`/api/events/${eventId}/invitee-fields`),
        fetch(`/api/events/${eventId}/assemblies`),
        fetch(`/api/events/${eventId}/ticketing`),
        fetch(`/api/events/${eventId}/groups`),
      ]);
      // A 500 has an empty, non-JSON body — never let parsing it throw and strand the page on
      // "Loading invitees…" forever (this happened in production when one request hit a dead DB
      // connection). Invitees and fields are required to render the table, so failing either is
      // shown as an error with a retry; the rest degrade to empty exactly as before.
      const json = async (res: Response) => { try { return await res.json(); } catch { return {}; } };
      if (!inviteesRes.ok || !fieldsRes.ok) {
        setLoadError("We couldn't load your invitees just now.");
        return;
      }
      const inviteesData = await json(inviteesRes);
      const fieldsData = await json(fieldsRes);
      setInvitees(inviteesData.invitees || []);
      setQuestions(inviteesData.questions || []);
      setAnswers(inviteesData.answers || {});
      setFields(visibleFields(fieldsData.fields || []));
      // 403 for a lead planner (or a network hiccup) just means no assembly filter/picker — not fatal.
      setAssemblies(assembliesRes.ok ? (await json(assembliesRes)).assemblies || [] : []);
      // Same tolerance for ticketing — a lead planner can't reach requireEventRole's "viewer" gate
      // the way this route checks it in every case, and it's a non-fatal, ticketing-only detail.
      setTicketFieldId(ticketingRes.ok ? (await json(ticketingRes)).config?.field?.id ?? null : null);
      setGroups(groupsRes.ok ? (await json(groupsRes)).groups || [] : []);
    } catch {
      // fetch() itself rejects only on a network failure (offline, DNS, connection reset).
      setLoadError("We couldn't reach the server just now.");
    } finally {
      setLoading(false);
    }
  }

  async function setTierValue(invitee: InviteeRow, fieldKey: string, value: string) {
    setTierBusyId(invitee.id);
    setActionError(null);
    const current = invitee.custom_fields ? JSON.parse(invitee.custom_fields) : {};
    try {
      const res = await fetch(`/api/events/${eventId}/invitees/${invitee.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customFields: { ...current, [fieldKey]: value } }),
      });
      setActionError(await errorFrom(res, "We couldn't change the ticket type. Please try again."));
    } catch {
      setActionError("We couldn't reach the server just now. Please try again.");
    }
    setTierBusyId(null);
    load();
    router.refresh();
  }

  // The server page normally hands over the first load already done; fetch only if it couldn't.
  useEffect(() => {
    if (!initialData) load();
  }, [eventId]);

  const [sort, onSort] = useTableSort(
    "inviteaz.sort.invitees",
    { key: "name", dir: "asc" },
    ["name", "clone", "status", "attending", "responded", ...fields.map((f) => `f:${f.key}`), ...questions.map((q) => `q:${q.id}`)]
  );
  const answerOf = (i: InviteeRow, questionId: string) =>
    (i.response_id ? answers[i.response_id] : undefined)?.find((a) => a.question_id === questionId)?.value || null;
  const [groupSort, onGroupSort] = useTableSort("inviteaz.sort.invitees.groups", { key: "name", dir: "asc" }, ["name", "clone", "members"]);

  // Filtered *and* sorted (the header arrows) — everything downstream, including select-all, works off this.
  const filtered = useMemo(() => {
    const name = (i: InviteeRow) => fullName(i.first_name, i.last_name);
    const sortField = sort.key.startsWith("f:") ? fields.find((f) => f.key === sort.key.slice(2)) : undefined;
    const value = (i: InviteeRow): SortValue =>
      sortField ? fieldSortValue(sortField, i)
        : sort.key.startsWith("q:") ? numericOrText(answerOf(i, sort.key.slice(2)))
          : sort.key === "clone" ? i.assembly_name
            : sort.key === "status" ? statusRank(i.status)
              : sort.key === "attending" ? (i.rsvp_status === "attending" ? i.num_attending ?? 1 : null)
                : sort.key === "responded" ? i.responded_at
                  : name(i);
    const matches = invitees.filter((i) => {
      if (statusFilter !== "all") {
        if (statusFilter === "no_response" && ["attending", "declined", "maybe"].includes(i.status)) return false;
        if (statusFilter !== "no_response" && i.status !== statusFilter) return false;
      }
      if (assemblyFilter === "unassigned" && i.assembly_id) return false;
      if (assemblyFilter !== "all" && assemblyFilter !== "unassigned" && i.assembly_id !== assemblyFilter) return false;
      if (!query) return true;
      const q = query.toLowerCase();
      return (
        fullName(i.first_name, i.last_name).toLowerCase().includes(q) ||
        (i.email || "").toLowerCase().includes(q) ||
        (i.group_name || "").toLowerCase().includes(q)
      );
    });
    return sortRows(matches, value, sort.dir, name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invitees, query, statusFilter, assemblyFilter, sort, fields, answers]);

  // ---- RSVP status (planner-recorded responses — see CLAUDE.md, "RSVP status & manual entry").
  // Every pick records a real response row; the header's numbers come from the server layout, hence
  // router.refresh() after each.
  async function setStatus(i: InviteeRow, status: Status, numAttending?: number) {
    if (!i.invitation_id) return;
    setStatusBusyId(i.invitation_id);
    setActionError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/responses/${i.invitation_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, numAttending }),
      });
      setActionError(await errorFrom(res, "We couldn't save that status. Please try again."));
    } catch {
      setActionError("We couldn't reach the server just now. Please try again.");
    }
    setStatusBusyId(null);
    load();
    router.refresh();
  }

  /** PATCH .../responses/bulk; returns the error to show, or null on success. */
  async function sendBulkStatus(invitationIds: string[], status: Status, numAttending?: number): Promise<string | null> {
    try {
      const res = await fetch(`/api/events/${eventId}/responses/bulk`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invitationIds, status, numAttending }),
      });
      return await errorFrom(res, "We couldn't save those statuses. Please try again.");
    } catch {
      return "We couldn't reach the server just now. Please try again.";
    }
  }
  const invitationIdsOf = (people: InviteeRow[]) => people.map((p) => p.invitation_id).filter((id): id is string => !!id);

  async function applyBulkStatus() {
    setBulkStatusBusy(true);
    setActionError(null);
    const failed = await sendBulkStatus(
      invitationIdsOf(invitees.filter((i) => selectedIds.has(i.id))),
      bulkStatus,
      bulkStatus === "attending" ? Number(bulkNum) || 1 : undefined
    );
    setBulkStatusBusy(false);
    // On a refusal (e.g. a ticket limit) keep the selection so the planner can adjust and retry.
    if (failed) { setActionError(failed); return; }
    setSelectedIds(new Set());
    load();
    router.refresh();
  }

  async function removeInvitee(id: string) {
    if (!confirm("Remove this invitee? Their RSVP history will be preserved for your records.")) return;
    await fetch(`/api/events/${eventId}/invitees/${id}`, { method: "DELETE" });
    load();
  }

  /** The household's /g/[token] link — one link that lets anyone in the group RSVP for everyone. */
  function copyGroupLink(group: GroupRow) {
    navigator.clipboard.writeText(`${window.location.origin}/g/${group.rsvp_token}`);
    setCopiedId(group.id);
    setTimeout(() => setCopiedId(null), 1600);
  }

  const [appleDevice, setAppleDevice] = useState(false);
  // The "Text" links need window.location, so they appear only after mount — rendering them during
  // render behind a `typeof window` check made the server and client markup differ (a hydration error
  // that switched the whole page to client rendering whenever anyone had a phone number).
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setAppleDevice(isAppleDevice(navigator.userAgent)); setMounted(true); }, []);

  /** sms: link for one person (their own RSVP link), or null when they have no usable phone. */
  function textHref(person: InviteeRow, path: string, household?: string): string | null {
    const phone = person.phone ? toE164(person.phone) : null;
    if (!phone) return null;
    const body = personalize(QUICK_TEXT, {
      firstName: person.first_name, name: household || fullName(person.first_name, person.last_name),
      event: eventName, link: `${window.location.origin}${path}`,
    });
    return smsHref(phone, body, appleDevice);
  }

  /** A household's group link goes to its leader if they have a phone, else the first member who does. */
  function groupTextTarget(g: GroupRow & { members: InviteeRow[] }): InviteeRow | undefined {
    const withPhone = g.members.filter((m) => m.phone && toE164(m.phone));
    return withPhone.find((m) => m.id === g.leader_invitee_id) || withPhone[0];
  }

  function copyLink(invitee: InviteeRow) {
    const url = `${window.location.origin}/r/${invitee.token}`;
    navigator.clipboard.writeText(url);
    setCopiedId(invitee.id);
    setTimeout(() => setCopiedId(null), 1600);
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every((i) => selectedIds.has(i.id));
  function toggleSelectAll() {
    setSelectedIds((prev) => {
      if (allFilteredSelected) {
        const next = new Set(prev);
        for (const i of filtered) next.delete(i.id);
        return next;
      }
      return new Set([...prev, ...filtered.map((i) => i.id)]);
    });
  }

  function selectGroup(groupName: string) {
    setSelectedIds((prev) => new Set([...prev, ...filtered.filter((i) => i.group_name === groupName).map((i) => i.id)]));
  }

  async function applyBulkEdit(fieldKey: string, value: string) {
    setActionError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/invitees/bulk`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selectedIds], fieldKey, value }),
      });
      const failed = await errorFrom(res, "We couldn't apply that change. Please try again.");
      // On a refusal (e.g. a ticket limit) keep the selection so the planner can adjust and retry.
      if (failed) { setActionError(failed); return; }
    } catch {
      setActionError("We couldn't reach the server just now. Please try again.");
      return;
    }
    setSelectedIds(new Set());
    load();
  }

  async function removeIds(ids: string[]) {
    const count = ids.length;
    if (!confirm(`Remove ${count} invitee${count === 1 ? "" : "s"}? Their RSVP history will be preserved for your records.`)) return;
    await fetch(`/api/events/${eventId}/invitees/bulk`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    setSelectedIds(new Set());
    load();
  }

  const removeSelected = () => removeIds([...selectedIds]);

  const groupOptions = useMemo(() => groupCounts(filtered, (i) => i.group_name), [filtered]);

  // Unfiltered on purpose — a group's member count/eligibility for actions shouldn't change
  // just because the current search/status/clone filter happens to hide its members.
  const groupRows = useMemo(
    () => groups.map((g) => ({ ...g, members: invitees.filter((i) => i.group_id === g.id) })),
    [groups, invitees]
  );

  // What the Group view *shows*: with any search/status/clone filter active, only groups with at least
  // one matching member, listing just those members (totalMembers keeps the real size for the count).
  // Group-level actions (bulk edit, remove, copy link) still act on groupRows' full membership.
  // A bulk action must never touch rows the planner can't currently see.
  useEffect(() => {
    setSelectedIds(new Set());
    setSelectedGroupIds(new Set());
  }, [query, statusFilter, assemblyFilter]);

  const groupFilterActive = !!query || statusFilter !== "all" || assemblyFilter !== "all";
  const visibleGroupRows = useMemo(() => {
    const matching = new Set(filtered.map((i) => i.id));
    // `counts` is the whole household's RSVP breakdown, even when a filter hides some members.
    const shown = !groupFilterActive
      ? groupRows.map((g) => ({ ...g, totalMembers: g.members.length, counts: breakdownOf(g.members) }))
      : groupRows
        .map((g) => ({ ...g, totalMembers: g.members.length, counts: breakdownOf(g.members), members: g.members.filter((m) => matching.has(m.id)) }))
        .filter((g) => g.members.length > 0 || (!!query && g.name.toLowerCase().includes(query.toLowerCase()) && statusFilter === "all"));
    const cloneName = (id: string | null) => assemblies.find((a) => a.id === id)?.name;
    return sortRows(
      shown,
      (g) => (groupSort.key === "clone" ? cloneName(g.assembly_id) : groupSort.key === "members" ? g.totalMembers : g.name),
      groupSort.dir,
      (g) => g.name
    );
  }, [groupRows, filtered, groupFilterActive, query, statusFilter, groupSort, assemblies]);

  // A ?clone= that isn't one of this event's clones (stale link, deleted clone) falls back to all clones.
  useEffect(() => {
    if (loading || assemblyFilter === "all" || assemblyFilter === "unassigned") return;
    if (!assemblies.some((a) => a.id === assemblyFilter)) setAssemblyFilter("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, assemblies, assemblyFilter]);

  // Counts for the chosen clone ("All clones" = the whole event), before search/status narrow it further.
  // A group counts toward a clone when any of its members is in that clone — the same rule the Group
  // view uses to decide which groups to show, so the number always matches the rows.
  const inChosenClone = (i: InviteeRow) =>
    assemblyFilter === "all" || (assemblyFilter === "unassigned" ? !i.assembly_id : i.assembly_id === assemblyFilter);
  const cloneInviteeCount = invitees.filter(inChosenClone).length;
  const cloneGroupCount = assemblyFilter === "all" ? groupRows.length : groupRows.filter((g) => g.members.some(inChosenClone)).length;
  const cloneLabel = assemblyFilter === "all"
    ? (assemblies.length > 0 ? "All clones" : null)
    : assemblyFilter === "unassigned" ? "Unassigned" : assemblies.find((a) => a.id === assemblyFilter)?.name ?? null;
  const narrowed = !!query || statusFilter !== "all";
  const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

  function bulkEditGroup(groupId: string) {
    const members = groupRows.find((g) => g.id === groupId)?.members || [];
    setSelectedIds(new Set(members.map((m) => m.id)));
    setShowBulkEdit(true);
  }

  function removeGroup(groupId: string) {
    const members = groupRows.find((g) => g.id === groupId)?.members || [];
    if (members.length === 0) return;
    removeIds(members.map((m) => m.id));
  }

  function startRenameGroup(g: GroupRow) {
    setRenamingGroupId(g.id);
    setRenameValue(g.name);
  }

  async function saveRenameGroup(groupId: string) {
    const name = renameValue.trim();
    setRenamingGroupId(null);
    if (!name) return;
    await fetch(`/api/events/${eventId}/groups/${groupId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    load();
  }

  async function deleteGroupRow(groupId: string) {
    if (!confirm("Delete this group? This can't be undone.")) return;
    setGroupBusyId(groupId);
    setGroupError(null);
    const res = await fetch(`/api/events/${eventId}/groups/${groupId}`, { method: "DELETE" });
    let data: any = {};
    try { data = await res.json(); } catch {}
    setGroupBusyId(null);
    if (!res.ok) { setGroupError(data.error || "Couldn't delete this group."); return; }
    load();
  }

  function toggleGroupSelected(id: string) {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allGroupsSelected = groupRows.length > 0 && groupRows.every((g) => selectedGroupIds.has(g.id));
  function toggleSelectAllGroups() {
    setSelectedGroupIds((prev) => {
      if (allGroupsSelected) return new Set();
      return new Set(groupRows.map((g) => g.id));
    });
  }

  function membersOfSelectedGroups() {
    return groupRows.filter((g) => selectedGroupIds.has(g.id)).flatMap((g) => g.members);
  }

  function bulkEditSelectedGroups() {
    setSelectedIds(new Set(membersOfSelectedGroups().map((m) => m.id)));
    setShowBulkEdit(true);
  }

  function removeSelectedGroups() {
    const ids = membersOfSelectedGroups().map((m) => m.id);
    if (ids.length === 0) return;
    setSelectedGroupIds(new Set());
    removeIds(ids);
  }

  async function deleteSelectedGroups() {
    const targets = groupRows.filter((g) => selectedGroupIds.has(g.id));
    const eligible = targets.filter((g) => g.members.length === 0);
    const skipped = targets.length - eligible.length;
    if (eligible.length === 0) {
      setGroupError("None of the selected groups can be deleted — they still have members.");
      return;
    }
    if (!confirm(`Delete ${eligible.length} group${eligible.length === 1 ? "" : "s"}? This can't be undone.`)) return;
    setGroupBulkBusy(true);
    setGroupError(null);
    let deleted = 0;
    let blocked = 0;
    for (const g of eligible) {
      const res = await fetch(`/api/events/${eventId}/groups/${g.id}`, { method: "DELETE" });
      if (res.ok) deleted++;
      else blocked++;
    }
    setGroupBulkBusy(false);
    setSelectedGroupIds(new Set());
    const notes: string[] = [];
    if (skipped > 0) notes.push(`${skipped} skipped (still had members)`);
    if (blocked > 0) notes.push(`${blocked} couldn't be deleted (likely payment history)`);
    if (notes.length > 0) setGroupError(`Deleted ${deleted} group${deleted === 1 ? "" : "s"} — ${notes.join(", ")}.`);
    load();
  }

  /** Sets every member of a group (the whole household, not just the filtered-in members). */
  async function setGroupStatus(groupId: string, status: Status) {
    const members = groupRows.find((g) => g.id === groupId)?.members || [];
    setGroupBusyId(groupId);
    setActionError(null);
    setActionError(await sendBulkStatus(invitationIdsOf(members), status, status === "attending" ? 1 : undefined));
    setGroupBusyId(null);
    load();
    router.refresh();
  }

  async function applyGroupBulkStatus() {
    setGroupBulkStatusBusy(true);
    setActionError(null);
    const failed = await sendBulkStatus(
      invitationIdsOf(membersOfSelectedGroups()),
      groupBulkStatus,
      groupBulkStatus === "attending" ? Number(groupBulkNum) || 1 : undefined
    );
    setGroupBulkStatusBusy(false);
    if (failed) { setActionError(failed); return; }
    setSelectedGroupIds(new Set());
    load();
    router.refresh();
  }

  // ---- Row actions (the ⋮ menu on phone cards) and the cells both layouts share.
  const ticketField = fields.find((f) => f.id === ticketFieldId);
  const hasPhone = (p: InviteeRow) => !!(p.phone && toE164(p.phone));
  const canEditStatus = (i: InviteeRow) => canMutate && !!i.invitation_id;

  function inviteeActions(i: InviteeRow): KebabItem[] {
    return [
      { label: "Copy RSVP link", onSelect: () => copyLink(i) },
      ...(hasPhone(i) ? [{ label: "Text RSVP link", onSelect: () => { const href = textHref(i, `/r/${i.token}`); if (href) window.location.href = href; } }] : []),
      ...(canMutate ? [
        { label: "Edit", onSelect: () => setEditing(i) },
        { label: "Remove", onSelect: () => removeInvitee(i.id) },
      ] : []),
    ];
  }

  function groupActions(g: (typeof visibleGroupRows)[number]): KebabItem[] {
    const items: KebabItem[] = [];
    if (g.totalMembers > 0 && g.rsvp_token) {
      const to = groupTextTarget(g);
      if (to) items.push({ label: `Text group link to ${to.first_name}`, onSelect: () => { const href = textHref(to, `/g/${g.rsvp_token}`, g.name); if (href) window.location.href = href; } });
      items.push({ label: "Copy group link", onSelect: () => copyGroupLink(g) });
    }
    if (!canMutate) return items;
    if (g.totalMembers > 0) {
      items.push({ label: "Bulk edit members", onSelect: () => bulkEditGroup(g.id) });
      items.push({ label: "Remove all members", onSelect: () => removeGroup(g.id) });
    }
    items.push({ label: "Rename", onSelect: () => startRenameGroup(g) });
    if (g.totalMembers === 0) items.push({ label: "Delete group", onSelect: () => deleteGroupRow(g.id) });
    return items;
  }

  /** The status column: the picker for anyone who can set it, else the status badge. */
  function statusCell(i: InviteeRow, large?: boolean) {
    if (!canEditStatus(i)) return <StatusBadge status={i.status} />;
    return (
      <>
        <StatusSegments large={large} current={i.rsvp_status} disabled={statusBusyId === i.invitation_id} onPick={(s) => setStatus(i, s)} />
        {!i.rsvp_status && <NoReplyNote invitationStatus={i.invitation_status} />}
      </>
    );
  }

  /** Party size: editable when attending and settable, plain text when attending and read-only. */
  function partySize(i: InviteeRow, large?: boolean) {
    if (i.rsvp_status !== "attending") return null;
    if (!canEditStatus(i)) return large ? <p className="mt-2 text-sm text-ink-soft">Party of {i.num_attending ?? 1}</p> : <>{i.num_attending ?? 1}</>;
    // Keyed on the response, so a newer response (from anyone) resets the box to its number.
    return <PartySize key={i.response_id} large={large} value={i.num_attending} onSave={(n) => setStatus(i, "attending", n)} />;
  }

  function ticketSelect(i: InviteeRow, f: InviteeField, className: string) {
    return (
      <select
        className={className}
        aria-label={f.label}
        disabled={tierBusyId === i.id}
        value={fieldValue(f, i) === "—" ? "" : fieldValue(f, i)}
        onChange={(e) => setTierValue(i, f.key, e.target.value)}
      >
        <option value="">—</option>
        {(f.options_json ? JSON.parse(f.options_json) : []).map((o: string) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  function linkActions(i: InviteeRow) {
    const href = mounted ? textHref(i, `/r/${i.token}`) : null;
    return (
      <>
        <button onClick={() => copyLink(i)} className="text-wine-500 hover:underline text-xs font-medium">
          {copiedId === i.id ? "Copied!" : "Copy link"}
        </button>
        {href && <a href={href} className="ml-3 text-wine-500 hover:underline text-xs font-medium" title="Opens your phone's Messages app with their RSVP link">Text</a>}
      </>
    );
  }

  const docked = canMutate && (view === "individual" ? selectedIds.size : selectedGroupIds.size) > 0;
  const sortOptions = [
    { key: "name", dir: "asc" as const, label: "Name A–Z" },
    { key: "name", dir: "desc" as const, label: "Name Z–A" },
    { key: "status", dir: "asc" as const, label: "Status" },
    ...(rsvpView ? [
      { key: "responded", dir: "desc" as const, label: "Latest response" },
      { key: "attending", dir: "desc" as const, label: "Largest party" },
    ] : []),
    ...(assemblies.length > 0 ? [{ key: "clone", dir: "asc" as const, label: "Clone" }] : []),
  ];

  return (
    <div className={`p-4 sm:p-8 ${docked ? "max-md:pb-44" : ""}`}>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap flex-1 min-w-[240px]">
          <input
            className="input max-w-xs"
            placeholder="Search name, email, or group…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select className="input max-w-[180px]" aria-label="RSVP status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="attending">Attending</option>
            <option value="maybe">Maybe</option>
            <option value="declined">Declined</option>
            <option value="no_response">No response</option>
          </select>
          {assemblies.length > 0 && (
            <select className="input max-w-[200px]" aria-label="Clone" value={assemblyFilter} onChange={(e) => setAssemblyFilter(e.target.value)}>
              <option value="all">All clones</option>
              <option value="unassigned">Unassigned</option>
              {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Phones: Upload and Add stay as buttons; exports, fields and the template go in a ⋮ menu. */}
          <div className="md:hidden order-last">
            <KebabMenu
              label="More invitee actions"
              items={[
                { label: "Export guest list (CSV)", onSelect: () => { window.location.href = `/api/events/${eventId}/export/invitees`; } },
                { label: "Export RSVP responses (CSV)", onSelect: () => { window.location.href = `/api/events/${eventId}/export/responses`; } },
                ...(canMutate ? [
                  { label: "Manage fields", onSelect: () => setShowFields(true) },
                  { label: "Download template", onSelect: () => { window.location.href = `/api/events/${eventId}/invitees/template`; } },
                ] : []),
              ]}
            />
          </div>
          <div className="max-md:hidden"><ExportMenu eventId={eventId} /></div>
          {canMutate && (
            <>
              <button onClick={() => setShowFields(true)} className="btn-ghost max-md:hidden">Manage fields</button>
              <a href={`/api/events/${eventId}/invitees/template`} download className="btn-ghost max-md:hidden">Download template</a>
              <button onClick={() => setShowUpload(true)} className="btn-secondary">Upload spreadsheet</button>
              <button onClick={() => setShowAdd(true)} className="btn-primary">+ Add invitee</button>
            </>
          )}
        </div>
      </div>

      {actionError && (
        <div role="alert" className="mt-4 flex items-start justify-between gap-3 rounded border border-clay-500/30 bg-clay-500/5 px-4 py-2.5 text-sm text-clay-600">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="shrink-0 font-medium hover:underline">Dismiss</button>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        {(groups.length > 0 || view === "group") && <ViewToggle value={view} onChange={setView} />}
        <div role="group" aria-label="Columns" className="inline-flex rounded border border-paper-line overflow-hidden text-sm">
          {(["details", "rsvp"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setColumns(c)}
              aria-pressed={columns === c}
              className={cn("px-3 py-1.5", columns === c ? "bg-wine-50 text-wine-700 font-medium" : "text-ink-soft hover:bg-paper-soft")}
            >
              {c === "details" ? "Details" : "RSVP"}
            </button>
          ))}
        </div>
        {!loading && !loadError && (
          <p className="text-sm text-ink-soft" aria-live="polite">
            {cloneLabel && <><span className="font-medium text-ink">{cloneLabel}</span> · </>}
            {plural(cloneInviteeCount, "invitee", "invitees")} · {plural(cloneGroupCount, "group", "groups")}
            {narrowed && (
              <span className="text-ink-faint">
                {" "}· showing {view === "individual"
                  ? `${formatNumber(filtered.length)} of ${formatNumber(cloneInviteeCount)}`
                  : `${formatNumber(visibleGroupRows.length)} of ${formatNumber(cloneGroupCount)} groups`}
              </span>
            )}
          </p>
        )}
      </div>

      {view === "individual" ? (
        <>
          {canMutate && selectedIds.size > 0 && (
            <div className={`mt-4 flex flex-wrap items-center justify-between gap-2 rounded border border-wine-200 bg-wine-50 px-4 py-2.5 ${MOBILE_DOCK}`}>
              <p className="text-sm text-wine-700">{selectedIds.size} selected</p>
              <div className="flex items-center gap-x-3 gap-y-2 flex-wrap">
                {groupOptions.length > 0 && (
                  <select className="input py-1 text-base sm:text-xs max-w-[200px]" value="" onChange={(e) => e.target.value && selectGroup(e.target.value)}>
                    <option value="">Select all in group…</option>
                    {groupOptions.map((g) => <option key={g.name} value={g.name}>{g.name} ({g.count})</option>)}
                  </select>
                )}
                <BulkStatusControls
                  status={bulkStatus} onStatus={setBulkStatus} num={bulkNum} onNum={setBulkNum}
                  busy={bulkStatusBusy} applyLabel={`Set for ${selectedIds.size}`} onApply={applyBulkStatus}
                />
                <button onClick={() => setShowBulkEdit(true)} className="text-sm font-medium text-wine-700 hover:underline">Bulk edit</button>
                <button onClick={removeSelected} className="text-sm font-medium text-clay-600 hover:underline">Remove selected</button>
                <button onClick={() => setSelectedIds(new Set())} className="text-sm font-medium text-wine-700 hover:underline">Clear selection</button>
              </div>
            </div>
          )}

          <div className="mt-6 card overflow-x-auto">
            {loading ? (
              <p className="p-8 text-sm text-ink-faint text-center">Loading invitees…</p>
            ) : loadError ? (
              <div className="p-8 text-sm text-center">
                <p className="text-clay-600">{loadError}</p>
                <button onClick={load} className="mt-3 btn-secondary">Try again</button>
              </div>
            ) : filtered.length === 0 ? (
              <p className="p-10 text-sm text-ink-faint text-center">
                {invitees.length === 0 ? (canMutate ? "No invitees yet. Add someone or upload a spreadsheet to get started." : "No invitees yet.") : "No invitees match your search."}
              </p>
            ) : (
              <>
              <div className="md:hidden">
                <MobileListHeader
                  selectAll={canMutate ? { checked: allFilteredSelected, onChange: toggleSelectAll } : undefined}
                  sort={<SortSelect sort={sort} onSort={onSort} options={sortOptions} />}
                />
                <ul className="divide-y divide-paper-line">
                  {filtered.map((i) => {
                    const name = fullName(i.first_name, i.last_name);
                    const responded = respondedText(i);
                    const details = (rsvpView
                      ? [assemblies.length > 0 ? i.assembly_name || "Unassigned" : null, responded ? `Responded ${responded}` : null]
                      : [assemblies.length > 0 ? i.assembly_name || "Unassigned" : null, i.group_name, i.email || i.phone]
                    ).filter(Boolean);
                    const answered = rsvpView ? questions.filter((q) => answerOf(i, q.id)) : [];
                    return (
                      <li key={i.id} className={cn("flex items-start gap-1 pr-2 py-1", canMutate ? "pl-1" : "pl-4")}>
                        {canMutate && <CardCheckbox checked={selectedIds.has(i.id)} onChange={() => toggleSelected(i.id)} label={`Select ${name}`} />}
                        <div className="min-w-0 flex-1 py-2.5">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-ink font-medium break-words">{name}</span>
                            {!canEditStatus(i) && <StatusBadge status={i.status} />}
                            {copiedId === i.id && <span className="text-xs text-moss-600">Link copied</span>}
                          </div>
                          {/* RSVP view's line is when/who responded — wrap it rather than cut it off. */}
                          {details.length > 0 && <p className={cn("mt-0.5 text-sm text-ink-faint", rsvpView ? "break-words" : "truncate")}>{details.join(" · ")}</p>}
                          {canEditStatus(i) && <div className="mt-2.5">{statusCell(i, true)}</div>}
                          {rsvpView && partySize(i, true)}
                          {!rsvpView && canMutate && ticketField && (
                            <label className="mt-2 flex items-center gap-2 text-sm text-ink-soft">
                              <span className="shrink-0">{ticketField.label}</span>
                              {ticketSelect(i, ticketField, "input py-1.5 text-base")}
                            </label>
                          )}
                          {answered.length > 0 && (
                            <details className="mt-2 text-sm">
                              <summary className="cursor-pointer py-1 font-medium text-wine-500">{answered.length} answer{answered.length === 1 ? "" : "s"}</summary>
                              <dl className="mt-1 space-y-1.5">
                                {answered.map((q) => (
                                  <div key={q.id}>
                                    <dt className="text-xs text-ink-faint">{q.label}</dt>
                                    <dd className="text-ink-soft break-words">{answerOf(i, q.id)}</dd>
                                  </div>
                                ))}
                              </dl>
                            </details>
                          )}
                        </div>
                        <KebabMenu label={`Actions for ${name}`} items={inviteeActions(i)} />
                      </li>
                    );
                  })}
                </ul>
              </div>
              <table className="hidden md:table w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-paper-line text-left text-ink-faint">
                    {canMutate && (
                      <th className="px-5 py-3 w-8">
                        <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} aria-label="Select all" />
                      </th>
                    )}
                    <SortTh label="Name" column="name" sort={sort} onSort={onSort} />
                    {assemblies.length > 0 && <SortTh label="Clone" column="clone" sort={sort} onSort={onSort} />}
                    <SortTh label="Status" column="status" sort={sort} onSort={onSort} />
                    {rsvpView ? (
                      <>
                        <SortTh label="# Attending" column="attending" sort={sort} onSort={onSort} firstDir="desc" />
                        {questions.map((q) => <SortTh key={q.id} label={q.label} column={`q:${q.id}`} sort={sort} onSort={onSort} />)}
                        <SortTh label="Responded" column="responded" sort={sort} onSort={onSort} firstDir="desc" />
                      </>
                    ) : (
                      <>
                        {fields.map((f) => (
                          <SortTh key={f.id} label={f.label} column={`f:${f.key}`} sort={sort} onSort={onSort} firstDir={f.field_type === "number" ? "desc" : "asc"} />
                        ))}
                        <th className="px-5 py-3 font-medium">RSVP link</th>
                      </>
                    )}
                    {canMutate && <th className="px-5 py-3"><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((i) => (
                    <tr key={i.id} className="border-b border-paper-line last:border-0 hover:bg-paper-soft/40 align-top">
                      {canMutate && (
                        <td className="px-5 py-3">
                          <input type="checkbox" checked={selectedIds.has(i.id)} onChange={() => toggleSelected(i.id)} aria-label={`Select ${fullName(i.first_name, i.last_name)}`} />
                        </td>
                      )}
                      <td className="px-5 py-3 whitespace-nowrap text-ink">{fullName(i.first_name, i.last_name)}</td>
                      {assemblies.length > 0 && (
                        <td className="px-5 py-3 text-ink-soft whitespace-nowrap">{i.assembly_name || "—"}</td>
                      )}
                      <td className="px-5 py-3 whitespace-nowrap">{statusCell(i)}</td>
                      {rsvpView ? (
                        <>
                          <td className="px-5 py-3 text-ink-soft">{partySize(i) ?? "—"}</td>
                          {questions.map((q) => <td key={q.id} className="px-5 py-3 text-ink-soft whitespace-nowrap">{answerOf(i, q.id) || "—"}</td>)}
                          <td className="px-5 py-3 text-ink-faint whitespace-nowrap">{respondedText(i) ?? "—"}</td>
                        </>
                      ) : (
                        <>
                          {fields.map((f) => (
                            <td key={f.id} className="px-5 py-3 text-ink-soft whitespace-nowrap">
                              {f.id === ticketFieldId && canMutate ? ticketSelect(i, f, "input py-1 text-base sm:text-xs") : fieldValue(f, i)}
                            </td>
                          ))}
                          <td className="px-5 py-3 whitespace-nowrap">{linkActions(i)}</td>
                        </>
                      )}
                      {canMutate && (
                        <td className="px-5 py-3 text-right whitespace-nowrap">
                          <button onClick={() => setEditing(i)} className="text-xs text-ink-faint hover:text-ink mr-3">Edit</button>
                          <button onClick={() => removeInvitee(i.id)} className="text-xs text-ink-faint hover:text-clay-600">Remove</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              </>
            )}
          </div>

        </>
      ) : (
        <>
          {groupError && (
            <div className="mt-4 rounded border border-clay-500/30 bg-clay-500/5 text-clay-600 text-sm px-4 py-2.5">{groupError}</div>
          )}

          {canMutate && selectedGroupIds.size > 0 && (
            <div className={`mt-4 flex flex-wrap items-center justify-between gap-2 rounded border border-wine-200 bg-wine-50 px-4 py-2.5 ${MOBILE_DOCK}`}>
              <p className="text-sm text-wine-700">{selectedGroupIds.size} group{selectedGroupIds.size === 1 ? "" : "s"} selected</p>
              <div className="flex items-center gap-x-3 gap-y-2 flex-wrap">
                <BulkStatusControls
                  status={groupBulkStatus} onStatus={setGroupBulkStatus} num={groupBulkNum} onNum={setGroupBulkNum}
                  busy={groupBulkStatusBusy} applyLabel={`Set for ${selectedGroupIds.size} group${selectedGroupIds.size === 1 ? "" : "s"}`} onApply={applyGroupBulkStatus}
                />
                {selectedGroupIds.size >= 2 && (
                  <button onClick={() => setShowMerge(true)} className="text-sm font-medium text-wine-700 hover:underline">Merge</button>
                )}
                <button onClick={bulkEditSelectedGroups} className="text-sm font-medium text-wine-700 hover:underline">Bulk edit</button>
                <button onClick={removeSelectedGroups} className="text-sm font-medium text-clay-600 hover:underline">Remove selected</button>
                <button onClick={deleteSelectedGroups} disabled={groupBulkBusy} className="text-sm font-medium text-clay-600 hover:underline disabled:opacity-50">
                  {groupBulkBusy ? "Deleting…" : "Delete selected"}
                </button>
                <button onClick={() => setSelectedGroupIds(new Set())} className="text-sm font-medium text-wine-700 hover:underline">Clear selection</button>
              </div>
            </div>
          )}

          <div className="mt-6 card overflow-x-auto">
            {loading ? (
              <p className="p-8 text-sm text-ink-faint text-center">Loading groups…</p>
            ) : visibleGroupRows.length === 0 ? (
              <p className="p-10 text-sm text-ink-faint text-center">{groupRows.length === 0 ? "No groups yet." : "No groups match your filters."}</p>
            ) : (
              <>
              <div className="md:hidden">
                <MobileListHeader
                  selectAll={canMutate ? { checked: allGroupsSelected, onChange: toggleSelectAllGroups } : undefined}
                  sort={
                    <SortSelect
                      sort={groupSort}
                      onSort={onGroupSort}
                      options={[
                        { key: "name", dir: "asc", label: "Name A–Z" },
                        { key: "name", dir: "desc", label: "Name Z–A" },
                        { key: "members", dir: "desc", label: "Most members" },
                        ...(assemblies.length > 0 ? [{ key: "clone", dir: "asc" as const, label: "Clone" }] : []),
                      ]}
                    />
                  }
                />
                <ul className="divide-y divide-paper-line">
                  {visibleGroupRows.map((g) => {
                    const expanded = expandedGroupIds.has(g.id);
                    const memberText = `${g.members.length !== g.totalMembers ? `${g.members.length} of ${g.totalMembers}` : g.totalMembers} member${g.totalMembers === 1 ? "" : "s"}`;
                    const details = [assemblies.length > 0 ? assemblies.find((a) => a.id === g.assembly_id)?.name || "Unassigned" : null, memberText].filter(Boolean);
                    const actions = groupActions(g);
                    return (
                      <li key={g.id}>
                        <div className={cn("flex items-start gap-1 pr-2 py-1", canMutate ? "pl-1" : "pl-4")}>
                          {canMutate && <CardCheckbox checked={selectedGroupIds.has(g.id)} onChange={() => toggleGroupSelected(g.id)} label={`Select ${g.name}`} />}
                          <div className="min-w-0 flex-1 py-2.5">
                            {renamingGroupId === g.id ? (
                              <input
                                className="input py-1.5 text-base"
                                autoFocus
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onBlur={() => saveRenameGroup(g.id)}
                                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRenamingGroupId(null); }}
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => toggleGroupExpanded(g.id)}
                                disabled={g.members.length === 0}
                                aria-expanded={g.members.length > 0 ? expanded : undefined}
                                className="flex w-full items-center gap-2 text-left text-ink font-medium disabled:cursor-default"
                              >
                                <span className="break-words">{g.name}</span>
                                {g.members.length > 0 && <span className="text-ink-faint" aria-hidden="true">{expanded ? "▾" : "▸"}</span>}
                              </button>
                            )}
                            <p className="mt-0.5 text-sm text-ink-faint">
                              {details.join(" · ")}
                              {copiedId === g.id && <span className="ml-2 text-xs text-moss-600">Group link copied</span>}
                            </p>
                            {g.totalMembers > 0 && <p className="mt-0.5 text-sm text-ink-soft"><Breakdown counts={g.counts} /></p>}
                            {canMutate && rsvpView && g.totalMembers > 0 && (
                              <div className="mt-2.5">
                                <p className="mb-1 text-xs text-ink-faint">Set status for everyone</p>
                                <StatusSegments large disabled={groupBusyId === g.id} onPick={(s) => setGroupStatus(g.id, s)} />
                              </div>
                            )}
                          </div>
                          {actions.length > 0 && <KebabMenu label={`Actions for ${g.name}`} items={actions} />}
                        </div>
                        {expanded && g.members.length > 0 && (
                          <ul className={cn("mr-2 mb-2 border-l-2 border-paper-line", canMutate ? "ml-12" : "ml-4")}>
                            {g.members.map((m) => {
                              const name = fullName(m.first_name, m.last_name);
                              return (
                                <li key={m.id} className="flex items-start gap-2 pl-3">
                                  <div className="min-w-0 flex-1 py-2 text-sm">
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                      <span className="text-ink break-words">{name}</span>
                                      {!canEditStatus(m) && <StatusBadge status={m.status} />}
                                      {!!m.added_by_guest && <span className="chip bg-brass-500/10 text-brass-600">Added by guest</span>}
                                      {copiedId === m.id && <span className="text-xs text-moss-600">Link copied</span>}
                                    </div>
                                    {canEditStatus(m) && <div className="mt-1.5">{statusCell(m, true)}</div>}
                                    {rsvpView && partySize(m, true)}
                                  </div>
                                  <KebabMenu label={`Actions for ${name}`} items={inviteeActions(m)} />
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
              <table className="hidden md:table w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-paper-line text-left text-ink-faint">
                    {canMutate && (
                      <th className="px-5 py-3 w-8">
                        <input type="checkbox" checked={allGroupsSelected} onChange={toggleSelectAllGroups} aria-label="Select all groups" />
                      </th>
                    )}
                    <SortTh label="Name" column="name" sort={groupSort} onSort={onGroupSort} />
                    {assemblies.length > 0 && <SortTh label="Clone" column="clone" sort={groupSort} onSort={onGroupSort} />}
                    <SortTh label="Members" column="members" sort={groupSort} onSort={onGroupSort} firstDir="desc" />
                    {canMutate && rsvpView && <th className="px-5 py-3 font-medium whitespace-nowrap">Set status for everyone</th>}
                    <th className="px-5 py-3"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleGroupRows.map((g) => {
                    const expanded = expandedGroupIds.has(g.id);
                    const groupColSpan = 3 + (canMutate ? 1 : 0) + (assemblies.length > 0 ? 1 : 0) + (canMutate && rsvpView ? 1 : 0);
                    const to = g.totalMembers > 0 ? groupTextTarget(g) : undefined;
                    const groupHref = to && mounted && g.rsvp_token ? textHref(to, `/g/${g.rsvp_token}`, g.name) : null;
                    return (
                    <Fragment key={g.id}>
                    <tr className="border-b border-paper-line last:border-0 hover:bg-paper-soft/40 align-top">
                      {canMutate && (
                        <td className="px-5 py-3">
                          <input type="checkbox" checked={selectedGroupIds.has(g.id)} onChange={() => toggleGroupSelected(g.id)} aria-label={`Select ${g.name}`} />
                        </td>
                      )}
                      <td className="px-5 py-3 text-ink">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleGroupExpanded(g.id)}
                            className="text-ink-faint hover:text-ink w-4 shrink-0"
                            aria-label={expanded ? `Collapse ${g.name}` : `Expand ${g.name}`}
                            disabled={g.members.length === 0}
                          >
                            {g.members.length > 0 ? (expanded ? "▾" : "▸") : ""}
                          </button>
                          {renamingGroupId === g.id ? (
                            <input
                              className="input py-1 text-base sm:text-xs"
                              autoFocus
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onBlur={() => saveRenameGroup(g.id)}
                              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRenamingGroupId(null); }}
                            />
                          ) : (
                            g.name
                          )}
                        </div>
                      </td>
                      {assemblies.length > 0 && (
                        <td className="px-5 py-3 text-ink-soft whitespace-nowrap">
                          {assemblies.find((a) => a.id === g.assembly_id)?.name || "—"}
                        </td>
                      )}
                      <td className="px-5 py-3 text-ink-soft whitespace-nowrap">
                        {g.members.length !== g.totalMembers ? `${g.members.length} of ${g.totalMembers}` : g.totalMembers} member{g.totalMembers === 1 ? "" : "s"}
                        {g.totalMembers > 0 && <span className="block text-xs"><Breakdown counts={g.counts} /></span>}
                      </td>
                      {canMutate && rsvpView && (
                        <td className="px-5 py-3">
                          {g.totalMembers > 0 && <StatusSegments disabled={groupBusyId === g.id} onPick={(s) => setGroupStatus(g.id, s)} />}
                        </td>
                      )}
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        {g.totalMembers > 0 && g.rsvp_token && (
                          <>
                            {groupHref && (
                              <a href={groupHref} className="text-wine-500 hover:underline text-xs font-medium mr-3" title={`Text the group link to ${fullName(to!.first_name, to!.last_name)} from your phone`}>
                                Text group link
                              </a>
                            )}
                            <button onClick={() => copyGroupLink(g)} className="text-wine-500 hover:underline text-xs font-medium mr-3" title="One link for the whole group to RSVP together">
                              {copiedId === g.id ? "Copied!" : "Copy group link"}
                            </button>
                          </>
                        )}
                        {canMutate && (
                          <>
                            <button onClick={() => bulkEditGroup(g.id)} disabled={g.totalMembers === 0} className="text-xs text-ink-faint hover:text-ink mr-3 disabled:opacity-40">Bulk edit</button>
                            <button onClick={() => removeGroup(g.id)} disabled={g.totalMembers === 0} className="text-xs text-ink-faint hover:text-clay-600 mr-3 disabled:opacity-40">Remove</button>
                            <button onClick={() => startRenameGroup(g)} className="text-xs text-ink-faint hover:text-ink mr-3">Rename</button>
                            {g.totalMembers === 0 && (
                              <button onClick={() => deleteGroupRow(g.id)} disabled={groupBusyId === g.id} className="text-xs text-clay-600 hover:underline disabled:opacity-40">
                                {groupBusyId === g.id ? "Deleting…" : "Delete"}
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                    {expanded && g.members.length > 0 && (
                      <tr className="border-b border-paper-line last:border-0 bg-paper-soft/30">
                        <td colSpan={groupColSpan} className="px-5 py-3">
                          <div className="pl-6 space-y-2">
                            {g.members.map((m) => (
                              <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 text-sm border-b border-paper-line/60 pb-2 last:border-0 last:pb-0">
                                <div className="flex items-center gap-3">
                                  <span className="text-ink">{fullName(m.first_name, m.last_name)}</span>
                                  {!!m.added_by_guest && <span className="chip bg-brass-500/10 text-brass-600">Added by guest</span>}
                                </div>
                                <div className="flex items-center gap-3">
                                  {rsvpView && partySize(m)}
                                  <div>{statusCell(m)}</div>
                                  <span>{linkActions(m)}</span>
                                  {canMutate && (
                                    <>
                                      <button onClick={() => setEditing(m)} className="text-xs text-ink-faint hover:text-ink">Edit</button>
                                      <button onClick={() => removeInvitee(m.id)} className="text-xs text-ink-faint hover:text-clay-600">Remove</button>
                                    </>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
              </>
            )}
          </div>
        </>
      )}

      {showMerge && (
        <MergeGroupsModal
          eventId={eventId}
          groups={groupRows.filter((g) => selectedGroupIds.has(g.id)).map((g) => ({ id: g.id, name: g.name, assembly_id: g.assembly_id, members: g.members.map((m) => fullName(m.first_name, m.last_name)) }))}
          onClose={() => setShowMerge(false)}
          onMerged={() => { setShowMerge(false); setSelectedGroupIds(new Set()); load(); router.refresh(); }}
        />
      )}
      {(showAdd || editing) && (
        <AddInviteeModal
          eventId={eventId}
          groupRsvpMode={groupRsvpMode}
          nameFormat={nameFormat}
          fields={fields}
          assemblies={assemblies}
          invitee={editing || undefined}
          groups={groupRows.map((g) => ({ id: g.id, name: g.name, assembly_id: g.assembly_id, memberCount: g.members.length }))}
          onClose={() => { setShowAdd(false); setEditing(null); }}
          onSaved={() => {
            setShowAdd(false);
            setEditing(null);
            load();
          }}
        />
      )}
      {showUpload && (
        <UploadModal
          eventId={eventId}
          groupRsvpMode={groupRsvpMode}
          onClose={() => setShowUpload(false)}
          onImported={() => {
            setShowUpload(false);
            load();
          }}
        />
      )}
      {showFields && (
        <FieldsManagerModal
          eventId={eventId}
          nameFormat={nameFormat}
          onClose={() => { setShowFields(false); load(); router.refresh(); }}
          onChanged={() => { load(); router.refresh(); }}
        />
      )}
      {showBulkEdit && (
        <BulkEditModal
          fields={fields}
          groupRsvpMode={groupRsvpMode}
          count={selectedIds.size}
          onApply={applyBulkEdit}
          onClose={() => setShowBulkEdit(false)}
        />
      )}
    </div>
  );
}
