import { NextResponse } from "next/server";
import { requireAssemblyScope } from "@/lib/session";
import { getEventById, logAudit } from "@/lib/models/events";
import { createGroup, createInvitee, countActiveInvitees, setGroupLeader, listGroups } from "@/lib/models/invitees";
import { getAssembly } from "@/lib/models/assemblies";
import { getUserById, PLAN_LIMITS } from "@/lib/models/users";

interface Row {
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
  const rows: Row[] = body.rows || [];
  if (rows.length === 0) return NextResponse.json({ error: "Nothing to import." }, { status: 400 });

  let assemblyId: string | null = access.assemblyId;
  if (!assemblyId && body.assemblyId) {
    const assembly = await getAssembly(body.assemblyId);
    if (!assembly || assembly.event_id !== params.id) return NextResponse.json({ error: "Clone not found." }, { status: 404 });
    assemblyId = assembly.id;
  }

  const owner = (await getUserById(event.owner_id))!;
  const limit = PLAN_LIMITS[owner.plan].inviteesPerEvent;
  const currentCount = await countActiveInvitees(params.id);
  if (currentCount + rows.length > limit) {
    return NextResponse.json(
      { error: `Importing ${rows.length} invitees would exceed your plan's limit of ${limit}. Upgrade or trim the list.` },
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
  let created = 0;

  for (const row of rows) {
    let groupId: string | null = null;
    if (row.groupName) {
      const key = row.groupName.toLowerCase();
      let group = existingGroups.get(key);
      if (!group) {
        group = await createGroup(params.id, row.groupName, assemblyId);
        existingGroups.set(key, group);
      }
      groupId = group.id;
    }

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

    if (groupId && row.groupLeader) {
      await setGroupLeader(groupId, invitee.id);
    }
  }

  await logAudit(params.id, access.user.email, "invitees.imported", `${created} invitees imported`);
  return NextResponse.json({ created });
}
