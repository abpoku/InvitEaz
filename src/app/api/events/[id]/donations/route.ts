import { NextResponse } from "next/server";
import { requireAssemblyScope } from "@/lib/session";
import { listDonations } from "@/lib/models/ticketing";

/** Every transaction that touched the donations bucket — behind the Tickets summary card's
 * Donations figure. Clone-scoped roles see only their own clone; a full-scope planner may narrow
 * with ?clone=, matching the Tickets tab's clone filter. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  const clone = new URL(req.url).searchParams.get("clone");
  return NextResponse.json({ donations: await listDonations(params.id, access.assemblyId || clone || null) });
}
