import { NextResponse } from "next/server";
import { requireSeatingAccess } from "@/lib/session";
import { listAssemblies } from "@/lib/models/assemblies";
import { listItems, listSeatingGuests, listPendingRequests, supersedeStaleRequests, tableUsage } from "@/lib/models/seating";

/** Everything the Seating tab shows. A clone planner gets the whole floor (so they can find their
 * tables) and every table's chair counts, but only their own clone's guests and requests, and no
 * other clone's name. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const access = await requireSeatingAccess(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });

  await supersedeStaleRequests(params.id);
  const [items, usage, guests, requests, clones] = await Promise.all([
    listItems(params.id),
    tableUsage(params.id),
    listSeatingGuests(params.id, access.assemblyId),
    listPendingRequests(params.id, access.assemblyId),
    listAssemblies(params.id),
  ]);
  return NextResponse.json({
    items,
    usage,
    guests,
    requests,
    clones: clones
      .map((c, index) => ({ id: c.id, name: c.name, index }))
      .filter((c) => !access.assemblyId || c.id === access.assemblyId),
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
