import { NextResponse } from "next/server";
import { requireAssemblyScope } from "@/lib/session";
import { getEventById, logAudit } from "@/lib/models/events";
import { createGroup, createInvitee, countActiveInvitees, setGroupLeader, listGroups, getInviteeById, canManageInvitee, updateInvitee, type InviteeRow } from "@/lib/models/invitees";
import { getAssembly } from "@/lib/models/assemblies";
import { getUserById, PLAN_LIMITS } from "@/lib/models/users";

interface ConfirmRow {
  rowNumber: number;
  action: "create" | "merge" | "skip";
  mergeIntoInviteeId?: string;
  firstName: string; lastName: string; email: string; phone: string;
  groupName: string; groupLeader: boolean; isAdult: boolean; plusOneAllowed: string; notes: string;
  customFields?: Record<string, string>;
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  if (access.role === "viewer") return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });

  const event = await getEventById(params.id);
  if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

  const body = await req.json();
  const rows: ConfirmRow[] = body.rows || [];
  if (rows.length === 0) return NextResponse.json({ error: "Nothing to import." }, { status: 400 });

  let assemblyId: string | null = access.assemblyId;
  if (!assemblyId && body.assemblyId) {
    const assembly = await getAssembly(body.assemblyId);
    if (!assembly || assembly.event_id !== params.id) return NextResponse.json({ error: "Clone not found." }, { status: 404 });
    assemblyId = assembly.id;
  }

  // A lead/co-planner can see a cross-assembly duplicate hint during preview, but must not be
  // able to merge-write an invitee outside their own assembly via a crafted request — reject the
  // whole import rather than silently dropping the offending rows (this path isn't reachable
  // through the normal UI, so an all-or-nothing rejection is fine).
  const mergeTargets = new Map<string, InviteeRow>();
  for (const row of rows) {
    if (row.action !== "merge") continue;
    if (!row.mergeIntoInviteeId) return NextResponse.json({ error: "A merge row is missing its target." }, { status: 400 });
    const target = await getInviteeById(row.mergeIntoInviteeId);
    if (!target || target.event_id !== params.id) return NextResponse.json({ error: "Merge target not found." }, { status: 404 });
    if (!(await canManageInvitee(row.mergeIntoInviteeId, params.id, access.assemblyId))) {
      return NextResponse.json({ error: "You don't have permission to merge into that invitee." }, { status: 403 });
    }
    mergeTargets.set(row.mergeIntoInviteeId, target);
  }

  const createCount = rows.filter((r) => r.action === "create").length;
  const owner = (await getUserById(event.owner_id))!;
  const limit = PLAN_LIMITS[owner.plan].inviteesPerEvent;
  const currentCount = await countActiveInvitees(params.id);
  if (currentCount + createCount > limit) {
    return NextResponse.json(
      { error: `Importing ${createCount} invitees would exceed your plan's limit of ${limit}. Upgrade or trim the list.` },
      { status: 402 }
    );
  }

  // listGroups(id, null) means "no filter" (used elsewhere for a full-scope planner's view), but
  // here a null assemblyId specifically means "importing as unassigned" — so match only groups
  // that are themselves unassigned, not every group across every assembly.
  const existingGroups = new Map(
    (await listGroups(params.id))
      .filter((g) => g.assembly_id === assemblyId)
      .map((g) => [g.name.toLowerCase(), g])
  );

  async function resolveGroupId(groupName: string): Promise<string | null> {
    if (!groupName) return null;
    const key = groupName.toLowerCase();
    let group = existingGroups.get(key);
    if (!group) {
      group = await createGroup(params.id, groupName, assemblyId);
      existingGroups.set(key, group);
    }
    return group.id;
  }

  let created = 0, merged = 0, skipped = 0;

  for (const row of rows) {
    if (row.action === "skip") {
      skipped += 1;
      continue;
    }

    if (row.action === "create") {
      const groupId = await resolveGroupId(row.groupName);
      const { invitee } = await createInvitee(params.id, {
        firstName: row.firstName,
        lastName: row.lastName,
        email: row.email || undefined,
        phone: row.phone || undefined,
        isAdult: row.isAdult,
        plusOnePolicy: (row.plusOneAllowed as any) || null,
        notes: row.notes || undefined,
        groupId,
        assemblyId,
        customFields: row.customFields,
      });
      created += 1;
      if (groupId && row.groupLeader) await setGroupLeader(groupId, invitee.id);
      continue;
    }

    // action === "merge" — reconcile onto the already-authorized existing invitee. Only
    // firstName/lastName/email/phone were actually shown to the planner in the merge picker, so
    // only those are unconditionally overwritten with the (already-resolved) chosen value.
    // Everything else — notes, group, plus-one policy, custom fields — the planner never reviewed,
    // so an uploaded row that simply lacks that column (most CSVs won't have a Notes column, say)
    // must not silently blank out data already on the existing invitee; fall back to the
    // existing value whenever the upload doesn't provide one. Deliberately leaves assembly_id
    // untouched either way — merging shouldn't relocate an existing invitee as a side effect of
    // which assembly the upload targeted.
    const target = mergeTargets.get(row.mergeIntoInviteeId!)!;
    const groupId = row.groupName ? await resolveGroupId(row.groupName) : target.group_id;
    const existingCustomFields = target.custom_fields ? JSON.parse(target.custom_fields) : {};
    const mergedCustomFields = { ...existingCustomFields };
    for (const [k, v] of Object.entries(row.customFields || {})) {
      if (v) mergedCustomFields[k] = v; // blank uploaded value leaves the existing one in place
    }
    await updateInvitee(row.mergeIntoInviteeId!, {
      first_name: row.firstName,
      last_name: row.lastName,
      email: row.email || null,
      phone: row.phone || null,
      is_adult: row.isAdult ? 1 : 0,
      plus_one_policy: (row.plusOneAllowed as any) || target.plus_one_policy,
      notes: row.notes || target.notes,
      group_id: groupId,
      custom_fields: Object.keys(mergedCustomFields).length ? JSON.stringify(mergedCustomFields) : null,
    });
    merged += 1;
    if (groupId && row.groupLeader) await setGroupLeader(groupId, row.mergeIntoInviteeId!);
  }

  await logAudit(params.id, access.user.email, "invitees.imported", `${created} created, ${merged} merged, ${skipped} skipped`);
  return NextResponse.json({ created, merged, skipped });
}
