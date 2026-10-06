import { NextResponse } from "next/server";
import { requireAssemblyScope } from "@/lib/session";
import { listCollected } from "@/lib/models/ticketing";

/** Every ticket payment/refund behind the Tickets summary card's Collected figure. Clone-scoped
 * roles see only their own clone; a full-scope planner may narrow with ?clone=, matching the card. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  const clone = new URL(req.url).searchParams.get("clone");
  return NextResponse.json({ payments: await listCollected(params.id, access.assemblyId || clone || null) });
}
