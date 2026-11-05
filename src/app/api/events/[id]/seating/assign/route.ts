import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSeatingAccess } from "@/lib/session";
import { logAudit } from "@/lib/models/events";
import { SeatingError, seatGuests } from "@/lib/models/seating";

const schema = z.object({
  inviteeIds: z.array(z.string()).min(1).max(500),
  tableId: z.string().nullable(), // null = unseat
});

/** Seat or unseat guests. For a clone planner, moving/unseating someone already seated is recorded
 * as a request for the owner instead (see seatGuests); the response says how many of each. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const access = await requireSeatingAccess(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  if (!access.canSeat) return NextResponse.json({ error: "You have view-only access to seating." }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  try {
    const result = await seatGuests(params.id, parsed.data.inviteeIds, parsed.data.tableId, { email: access.user.email, assemblyId: access.assemblyId });
    if (result.seated || result.requested) {
      await logAudit(params.id, access.user.email, parsed.data.tableId ? "seating.assigned" : "seating.unseated",
        `${result.seated} applied, ${result.requested} sent for approval`);
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SeatingError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
