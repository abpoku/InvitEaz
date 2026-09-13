import { NextResponse } from "next/server";
import { requireEventRole } from "@/lib/session";
import { getEventById, logAudit } from "@/lib/models/events";
import { createGroup, createInvitee, countActiveInvitees, setGroupLeader, listGroups } from "@/lib/models/invitees";
import { getUserById, PLAN_LIMITS } from "@/lib/models/users";

interface Row {
  firstName: string; lastName: string; email: string; phone: string;
  groupName: string; groupLeader: boolean; isAdult: boolean; plusOneAllowed: string; notes: string;
  customFields?: Record<string, string>;
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });

  const event = await getEventById(params.id);
  if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

  const body = await req.json();
  const rows: Row[] = body.rows || [];
  if (rows.length === 0) return NextResponse.json({ error: "Nothing to import." }, { status: 400 });

  const owner = (await getUserById(event.owner_id))!;
  const limit = PLAN_LIMITS[owner.plan].inviteesPerEvent;
  const currentCount = await countActiveInvitees(params.id);
  if (currentCount + rows.length > limit) {
    return NextResponse.json(
      { error: `Importing ${rows.length} invitees would exceed your plan's limit of ${limit}. Upgrade or trim the list.` },
      { status: 402 }
    );
  }

  const existingGroups = new Map((await listGroups(params.id)).map((g) => [g.name.toLowerCase(), g]));
  let created = 0;

  for (const row of rows) {
    let groupId: string | null = null;
    if (row.groupName) {
      const key = row.groupName.toLowerCase();
      let group = existingGroups.get(key);
      if (!group) {
        group = await createGroup(params.id, row.groupName);
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
