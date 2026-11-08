import { NextResponse } from "next/server";
import { requireAssemblyScope } from "@/lib/session";
import { listTransactions } from "@/lib/models/ticketing";

/** Every payment and refund for the Tickets tab's "All transactions" list, voided ones included.
 * Clone-scoped roles see only their own clone; a full-scope planner may narrow with ?clone=, matching
 * the Tickets tab's clone filter. Read-only, so viewers may see it too. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  const clone = new URL(req.url).searchParams.get("clone");
  return NextResponse.json({ transactions: await listTransactions(params.id, access.assemblyId || clone || null) });
}
