import { NextResponse } from "next/server";
import { requireSeatingAccess } from "@/lib/session";
import { listAssemblies } from "@/lib/models/assemblies";
import { getEventById, logAudit, updateEvent } from "@/lib/models/events";
import { listItems, listSeatingGuests, listPendingRequests, supersedeStaleRequests, tableUsage } from "@/lib/models/seating";

/** Everything the Seating tab shows. A clone planner gets the whole floor (so they can find their
 * tables) and every table's chair counts, but only their own clone's guests and requests, and no
 * other clone's name. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const access = await requireSeatingAccess(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });

  await supersedeStaleRequests(params.id);
  const [items, usage, guests, requests, clones, event] = await Promise.all([
    listItems(params.id),
    tableUsage(params.id),
    listSeatingGuests(params.id, access.assemblyId),
    listPendingRequests(params.id, access.assemblyId),
    listAssemblies(params.id),
    getEventById(params.id),
  ]);
  return NextResponse.json({
    items,
    usage,
    guests,
    requests,
    clones: clones
      .map((c, index) => ({ id: c.id, name: c.name, index }))
      .filter((c) => !access.assemblyId || c.id === access.assemblyId),
    guestsCanSee: !!event?.seating_visible,
    me: {
      role: access.role,
      email: access.user.email,
      assemblyId: access.assemblyId,
      canEditLayout: access.canEditLayout,
      canSeat: access.canSeat,
      canApprove: access.canApprove,
    },
  });
}

/** Owner/admin: share seating with guests (or stop). Guests then see their table, tablemates and
 * where it is on the floor on their invitation links. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const access = await requireSeatingAccess(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  if (!access.canEditLayout) return NextResponse.json({ error: "Only the event owner or an admin can share seating with guests." }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (typeof body?.guestsCanSee !== "boolean") return NextResponse.json({ error: "guestsCanSee must be true or false." }, { status: 400 });
  await updateEvent(params.id, { seating_visible: body.guestsCanSee ? 1 : 0 });
  await logAudit(params.id, access.user.email, body.guestsCanSee ? "seating.shared" : "seating.unshared", "");
  return NextResponse.json({ guestsCanSee: body.guestsCanSee });
}
