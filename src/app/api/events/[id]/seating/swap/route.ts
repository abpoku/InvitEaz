import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSeatingAccess } from "@/lib/session";
import { logAudit } from "@/lib/models/events";
import { SeatingError, swapGuests } from "@/lib/models/seating";

const schema = z.object({
  a: z.array(z.string()).min(1).max(200), // all at one table
  b: z.array(z.string()).min(1).max(200), // all at another table
});

/** Owner/admin: swap guests between two tables in one go (see swapGuests). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const access = await requireSeatingAccess(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  if (!access.canSeat) return NextResponse.json({ error: "You have view-only access to seating." }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  try {
    const result = await swapGuests(params.id, parsed.data.a, parsed.data.b, { email: access.user.email, assemblyId: access.assemblyId });
    await logAudit(params.id, access.user.email, "seating.swapped", `${parsed.data.a.length} ↔ ${parsed.data.b.length}`);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SeatingError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
