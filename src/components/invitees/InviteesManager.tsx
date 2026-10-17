"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
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
import { sortRows, statusRank, numericOrText, type SortValue, type SortState, type SortDir } from "@/lib/table-sort";
import { fullName, formatNumber } from "@/lib/utils";
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
  status: string;
  added_by_guest: number;
}

/** What the server page loads up front (see invitees/page.tsx) — the same data load() fetches. */
export interface InviteesInitialData {
  invitees: InviteeRow[];
  fields: InviteeField[];
  assemblies: Assembly[];
  ticketFieldId: string | null;
  groups: GroupRow[];
}

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

/** Phones only: the selection's bulk-action bar docks to the bottom of the screen (reachable from
 * anywhere in a long list) instead of sitting above it. The page adds bottom padding while it shows. */
const MOBILE_DOCK =
  "max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-30 max-md:mt-0 max-md:rounded-none max-md:border-x-0 max-md:border-b-0 max-md:shadow-lifted max-md:pb-[calc(0.625rem+env(safe-area-inset-bottom))]";

/** The phone layout has no column headings to tap, so sorting is a dropdown driving the same
 * useTableSort state (and remembered sort) as the desktop table's headings. */
function SortSelect({ sort, onSort, options }: {
  sort: SortState;
  onSort: (key: string, firstDir: SortDir) => void;
  options: { key: string; dir: SortDir; label: string }[];
}) {
  const value = `${sort.key}:${sort.dir}`;
  const known = options.some((o) => `${o.key}:${o.dir}` === value);
  return (
    <select
      aria-label="Sort by"
      className="input w-auto py-1.5 text-base"
      value={known ? value : ""}
      onChange={(e) => {
        const o = options.find((x) => `${x.key}:${x.dir}` === e.target.value);
        // onSort flips the direction of the current column and starts a new column at firstDir,
        // so one call lands on exactly the option picked.
        if (o && (o.key !== sort.key || o.dir !== sort.dir)) onSort(o.key, o.dir);
      }}
    >
      {!known && <option value="">Sorted by a column</option>}
      {options.map((o) => <option key={`${o.key}:${o.dir}`} value={`${o.key}:${o.dir}`}>{o.label}</option>)}
    </select>
  );
}

/** The server's error message for a failed write (e.g. a ticket limit refusing it), or null when it
 * succeeded. A crash returns an empty body, so never let parsing it throw. */
async function errorFrom(res: Response, fallback: string): Promise<string | null> {
  if (res.ok) return null;
  let data: any = {};
  try { data = await res.json(); } catch {}
  return data.error || fallback;
}

export function InviteesManager({ eventId, groupRsvpMode, nameFormat, eventName = "our event", initialData }: { eventId: string; groupRsvpMode: string; nameFormat: "first_last" | "full"; eventName?: string; initialData?: InviteesInitialData }) {
  const router = useRouter();
  const [invitees, setInvitees] = useState<InviteeRow[]>(initialData?.invitees ?? []);
  const [fields, setFields] = useState<InviteeField[]>(visibleFields(initialData?.fields ?? []));
  const [assemblies, setAssemblies] = useState<Assembly[]>(initialData?.assemblies ?? []);
  const [groups, setGroups] = useState<GroupRow[]>(initialData?.groups ?? []);
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
    ["name", "clone", "status", ...fields.map((f) => `f:${f.key}`)]
  );
  const [groupSort, onGroupSort] = useTableSort("inviteaz.sort.invitees.groups", { key: "name", dir: "asc" }, ["name", "clone", "members"]);

  // Filtered *and* sorted (the header arrows) — everything downstream, including select-all, works off this.
  const filtered = useMemo(() => {
    const name = (i: InviteeRow) => fullName(i.first_name, i.last_name);
    const sortField = sort.key.startsWith("f:") ? fields.find((f) => f.key === sort.key.slice(2)) : undefined;
    const value = (i: InviteeRow): SortValue =>
      sortField ? fieldSortValue(sortField, i)
        : sort.key === "clone" ? i.assembly_name
          : sort.key === "status" ? statusRank(i.status)
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
  }, [invitees, query, statusFilter, assemblyFilter, sort, fields]);

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
  useEffect(() => { setAppleDevice(isAppleDevice(navigator.userAgent)); }, []);

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
    const shown = !groupFilterActive
      ? groupRows.map((g) => ({ ...g, totalMembers: g.members.length }))
      : groupRows
        .map((g) => ({ ...g, totalMembers: g.members.length, members: g.members.filter((m) => matching.has(m.id)) }))
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

  // ---- Phone layout (below md): cards with a ⋮ menu instead of the wide tables. Same rows, selection,
  // sort and handlers as the tables, so the two can't disagree.
  const ticketField = fields.find((f) => f.id === ticketFieldId);
  const hasPhone = (p: InviteeRow) => !!(p.phone && toE164(p.phone));

  function inviteeActions(i: InviteeRow): KebabItem[] {
    return [
      { label: "Copy RSVP link", onSelect: () => copyLink(i) },
      ...(hasPhone(i) ? [{ label: "Text RSVP link", onSelect: () => { const href = textHref(i, `/r/${i.token}`); if (href) window.location.href = href; } }] : []),
      { label: "Edit", onSelect: () => setEditing(i) },
      { label: "Remove", onSelect: () => removeInvitee(i.id) },
    ];
  }

  function groupActions(g: (typeof visibleGroupRows)[number]): KebabItem[] {
    const items: KebabItem[] = [];
    if (g.totalMembers > 0 && g.rsvp_token) {
      const to = groupTextTarget(g);
      if (to) items.push({ label: `Text group link to ${to.first_name}`, onSelect: () => { const href = textHref(to, `/g/${g.rsvp_token}`, g.name); if (href) window.location.href = href; } });
      items.push({ label: "Copy group link", onSelect: () => copyGroupLink(g) });
    }
    if (g.totalMembers > 0) {
      items.push({ label: "Bulk edit members", onSelect: () => bulkEditGroup(g.id) });
      items.push({ label: "Remove all members", onSelect: () => removeGroup(g.id) });
    }
    items.push({ label: "Rename", onSelect: () => startRenameGroup(g) });
    if (g.totalMembers === 0) items.push({ label: "Delete group", onSelect: () => deleteGroupRow(g.id) });
    return items;
  }

  const docked = (view === "individual" ? selectedIds.size : selectedGroupIds.size) > 0;

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
          <select className="input max-w-[180px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="attending">Attending</option>
            <option value="maybe">Maybe</option>
            <option value="declined">Declined</option>
            <option value="no_response">No response</option>
          </select>
          {assemblies.length > 0 && (
            <select className="input max-w-[200px]" value={assemblyFilter} onChange={(e) => setAssemblyFilter(e.target.value)}>
              <option value="all">All clones</option>
              <option value="unassigned">Unassigned</option>
              {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setShowFields(true)} className="btn-ghost">Manage fields</button>
          <a href={`/api/events/${eventId}/invitees/template`} download className="btn-ghost">Download template</a>
          <button onClick={() => setShowUpload(true)} className="btn-secondary">Upload spreadsheet</button>
          <button onClick={() => setShowAdd(true)} className="btn-primary">+ Add invitee</button>
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
          {selectedIds.size > 0 && (
            <div className={`mt-4 flex flex-wrap items-center justify-between gap-2 rounded border border-wine-200 bg-wine-50 px-4 py-2.5 ${MOBILE_DOCK}`}>
              <p className="text-sm text-wine-700">{selectedIds.size} selected</p>
              <div className="flex items-center gap-3 flex-wrap">
                {groupOptions.length > 0 && (
                  <select className="input py-1 text-base sm:text-xs max-w-[200px]" value="" onChange={(e) => e.target.value && selectGroup(e.target.value)}>
                    <option value="">Select all in group…</option>
                    {groupOptions.map((g) => <option key={g.name} value={g.name}>{g.name} ({g.count})</option>)}
                  </select>
                )}
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
                {invitees.length === 0 ? "No invitees yet. Add someone or upload a spreadsheet to get started." : "No invitees match your search."}
              </p>
            ) : (
              <>
              <div className="md:hidden">
                <div className="flex items-center justify-between gap-3 pl-1 pr-3 border-b border-paper-line">
                  <label className="flex items-center text-sm text-ink-soft">
                    <span className="flex h-11 w-11 items-center justify-center">
                      <input type="checkbox" className="h-5 w-5" checked={allFilteredSelected} onChange={toggleSelectAll} />
                    </span>
                    Select all
                  </label>
                  <SortSelect
                    sort={sort}
                    onSort={onSort}
                    options={[
                      { key: "name", dir: "asc", label: "Name A–Z" },
                      { key: "name", dir: "desc", label: "Name Z–A" },
                      { key: "status", dir: "asc", label: "Status" },
                      ...(assemblies.length > 0 ? [{ key: "clone", dir: "asc" as const, label: "Clone" }] : []),
                    ]}
                  />
                </div>
                <ul className="divide-y divide-paper-line">
                  {filtered.map((i) => {
                    const name = fullName(i.first_name, i.last_name);
                    const details = [assemblies.length > 0 ? i.assembly_name || "Unassigned" : null, i.group_name, i.email || i.phone].filter(Boolean);
                    return (
                      <li key={i.id} className="flex items-start gap-1 pl-1 pr-2 py-1">
                        <label className="flex h-11 w-11 shrink-0 items-center justify-center">
                          <input type="checkbox" className="h-5 w-5" checked={selectedIds.has(i.id)} onChange={() => toggleSelected(i.id)} aria-label={`Select ${name}`} />
                        </label>
                        <div className="min-w-0 flex-1 py-2.5">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-ink font-medium break-words">{name}</span>
                            <StatusBadge status={i.status} />
                            {copiedId === i.id && <span className="text-xs text-moss-600">Link copied</span>}
                          </div>
                          {details.length > 0 && <p className="mt-0.5 text-sm text-ink-faint truncate">{details.join(" · ")}</p>}
                          {ticketField && (
                            <label className="mt-2 flex items-center gap-2 text-sm text-ink-soft">
                              <span className="shrink-0">{ticketField.label}</span>
                              <select
                                className="input py-1.5 text-base"
                                disabled={tierBusyId === i.id}
                                value={fieldValue(ticketField, i) === "—" ? "" : fieldValue(ticketField, i)}
                                onChange={(e) => setTierValue(i, ticketField.key, e.target.value)}
                              >
                                <option value="">—</option>
                                {(ticketField.options_json ? JSON.parse(ticketField.options_json) : []).map((o: string) => <option key={o} value={o}>{o}</option>)}
                              </select>
                            </label>
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
                    <th className="px-5 py-3 w-8">
                      <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} aria-label="Select all" />
                    </th>
                    <SortTh label="Name" column="name" sort={sort} onSort={onSort} />
                    {assemblies.length > 0 && <SortTh label="Clone" column="clone" sort={sort} onSort={onSort} />}
                    {fields.map((f) => (
                      <SortTh key={f.id} label={f.label} column={`f:${f.key}`} sort={sort} onSort={onSort} firstDir={f.field_type === "number" ? "desc" : "asc"} />
                    ))}
                    <SortTh label="Status" column="status" sort={sort} onSort={onSort} />
                    <th className="px-5 py-3 font-medium">RSVP link</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((i) => (
                    <tr key={i.id} className="border-b border-paper-line last:border-0 hover:bg-paper-soft/40">
                      <td className="px-5 py-3">
                        <input type="checkbox" checked={selectedIds.has(i.id)} onChange={() => toggleSelected(i.id)} aria-label={`Select ${fullName(i.first_name, i.last_name)}`} />
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <p className="text-ink">{fullName(i.first_name, i.last_name)}</p>
                      </td>
                      {assemblies.length > 0 && (
                        <td className="px-5 py-3 text-ink-soft whitespace-nowrap">{i.assembly_name || "—"}</td>
                      )}
                      {fields.map((f) => (
                        <td key={f.id} className="px-5 py-3 text-ink-soft whitespace-nowrap">
                          {f.id === ticketFieldId ? (
                            <select
                              className="input py-1 text-base sm:text-xs"
                              disabled={tierBusyId === i.id}
                              value={fieldValue(f, i) === "—" ? "" : fieldValue(f, i)}
                              onChange={(e) => setTierValue(i, f.key, e.target.value)}
                            >
                              <option value="">—</option>
                              {(f.options_json ? JSON.parse(f.options_json) : []).map((o: string) => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : (
                            fieldValue(f, i)
                          )}
                        </td>
                      ))}
                      <td className="px-5 py-3"><StatusBadge status={i.status} /></td>
                      <td className="px-5 py-3">
                        <button onClick={() => copyLink(i)} className="text-wine-500 hover:underline text-xs font-medium">
                          {copiedId === i.id ? "Copied!" : "Copy link"}
                        </button>
                        {(() => {
                          const href = typeof window !== "undefined" ? textHref(i, `/r/${i.token}`) : null;
                          return href ? (
                            <a href={href} className="ml-3 text-wine-500 hover:underline text-xs font-medium" title="Opens your phone's Messages app with their RSVP link">Text</a>
                          ) : null;
                        })()}
                      </td>
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        <button onClick={() => setEditing(i)} className="text-xs text-ink-faint hover:text-ink mr-3">Edit</button>
                        <button onClick={() => removeInvitee(i.id)} className="text-xs text-ink-faint hover:text-clay-600">Remove</button>
                      </td>
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

          {selectedGroupIds.size > 0 && (
            <div className={`mt-4 flex flex-wrap items-center justify-between gap-2 rounded border border-wine-200 bg-wine-50 px-4 py-2.5 ${MOBILE_DOCK}`}>
              <p className="text-sm text-wine-700">{selectedGroupIds.size} group{selectedGroupIds.size === 1 ? "" : "s"} selected</p>
              <div className="flex items-center gap-3 flex-wrap">
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
                <div className="flex items-center justify-between gap-3 pl-1 pr-3 border-b border-paper-line">
                  <label className="flex items-center text-sm text-ink-soft">
                    <span className="flex h-11 w-11 items-center justify-center">
                      <input type="checkbox" className="h-5 w-5" checked={allGroupsSelected} onChange={toggleSelectAllGroups} />
                    </span>
                    Select all
                  </label>
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
                </div>
                <ul className="divide-y divide-paper-line">
                  {visibleGroupRows.map((g) => {
                    const expanded = expandedGroupIds.has(g.id);
                    const memberText = `${g.members.length !== g.totalMembers ? `${g.members.length} of ${g.totalMembers}` : g.totalMembers} member${g.totalMembers === 1 ? "" : "s"}`;
                    const details = [assemblies.length > 0 ? assemblies.find((a) => a.id === g.assembly_id)?.name || "Unassigned" : null, memberText].filter(Boolean);
                    return (
                      <li key={g.id}>
                        <div className="flex items-start gap-1 pl-1 pr-2 py-1">
                          <label className="flex h-11 w-11 shrink-0 items-center justify-center">
                            <input type="checkbox" className="h-5 w-5" checked={selectedGroupIds.has(g.id)} onChange={() => toggleGroupSelected(g.id)} aria-label={`Select ${g.name}`} />
                          </label>
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
                          </div>
                          <KebabMenu label={`Actions for ${g.name}`} items={groupActions(g)} />
                        </div>
                        {expanded && g.members.length > 0 && (
                          <ul className="ml-12 mr-2 mb-2 border-l-2 border-paper-line">
                            {g.members.map((m) => {
                              const name = fullName(m.first_name, m.last_name);
                              return (
                                <li key={m.id} className="flex items-center gap-2 pl-3">
                                  <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-sm">
                                    <span className="text-ink break-words">{name}</span>
                                    <StatusBadge status={m.status} />
                                    {!!m.added_by_guest && <span className="chip bg-brass-500/10 text-brass-600">Added by guest</span>}
                                    {copiedId === m.id && <span className="text-xs text-moss-600">Link copied</span>}
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
                    <th className="px-5 py-3 w-8">
                      <input type="checkbox" checked={allGroupsSelected} onChange={toggleSelectAllGroups} aria-label="Select all groups" />
                    </th>
                    <SortTh label="Name" column="name" sort={groupSort} onSort={onGroupSort} />
                    {assemblies.length > 0 && <SortTh label="Clone" column="clone" sort={groupSort} onSort={onGroupSort} />}
                    <SortTh label="Members" column="members" sort={groupSort} onSort={onGroupSort} firstDir="desc" />
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleGroupRows.map((g) => {
                    const expanded = expandedGroupIds.has(g.id);
                    const groupColSpan = 4 + (assemblies.length > 0 ? 1 : 0);
                    return (
                    <Fragment key={g.id}>
                    <tr className="border-b border-paper-line last:border-0 hover:bg-paper-soft/40">
                      <td className="px-5 py-3">
                        <input type="checkbox" checked={selectedGroupIds.has(g.id)} onChange={() => toggleGroupSelected(g.id)} aria-label={`Select ${g.name}`} />
                      </td>
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
                      </td>
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        {g.totalMembers > 0 && g.rsvp_token && (
                          <>
                          {(() => {
                            const to = groupTextTarget(g);
                            const href = to && typeof window !== "undefined" ? textHref(to, `/g/${g.rsvp_token}`, g.name) : null;
                            return href ? (
                              <a href={href} className="text-wine-500 hover:underline text-xs font-medium mr-3" title={`Text the group link to ${fullName(to!.first_name, to!.last_name)} from your phone`}>
                                Text group link
                              </a>
                            ) : null;
                          })()}
                          <button onClick={() => copyGroupLink(g)} className="text-wine-500 hover:underline text-xs font-medium mr-3" title="One link for the whole group to RSVP together">
                            {copiedId === g.id ? "Copied!" : "Copy group link"}
                          </button>
                          </>
                        )}
                        <button onClick={() => bulkEditGroup(g.id)} disabled={g.totalMembers === 0} className="text-xs text-ink-faint hover:text-ink mr-3 disabled:opacity-40">Bulk edit</button>
                        <button onClick={() => removeGroup(g.id)} disabled={g.totalMembers === 0} className="text-xs text-ink-faint hover:text-clay-600 mr-3 disabled:opacity-40">Remove</button>
                        <button onClick={() => startRenameGroup(g)} className="text-xs text-ink-faint hover:text-ink mr-3">Rename</button>
                        {g.totalMembers === 0 && (
                          <button onClick={() => deleteGroupRow(g.id)} disabled={groupBusyId === g.id} className="text-xs text-clay-600 hover:underline disabled:opacity-40">
                            {groupBusyId === g.id ? "Deleting…" : "Delete"}
                          </button>
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
                                  <StatusBadge status={m.status} />
                                  {!!m.added_by_guest && <span className="chip bg-brass-500/10 text-brass-600">Added by guest</span>}
                                </div>
                                <div className="flex items-center gap-3">
                                  <button onClick={() => copyLink(m)} className="text-wine-500 hover:underline text-xs font-medium">
                                    {copiedId === m.id ? "Copied!" : "Copy link"}
                                  </button>
                                  {(() => {
                                    const href = typeof window !== "undefined" ? textHref(m, `/r/${m.token}`) : null;
                                    return href ? <a href={href} className="text-wine-500 hover:underline text-xs font-medium">Text</a> : null;
                                  })()}
                                  <button onClick={() => setEditing(m)} className="text-xs text-ink-faint hover:text-ink">Edit</button>
                                  <button onClick={() => removeInvitee(m.id)} className="text-xs text-ink-faint hover:text-clay-600">Remove</button>
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
