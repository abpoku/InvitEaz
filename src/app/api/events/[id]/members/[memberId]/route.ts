import { NextResponse } from "next/server";
import { requireEventRole } from "@/lib/session";
import { removeCoPlanner, logAudit } from "@/lib/models/events";

export async function DELETE(_req: Request, { params }: { params: { id: string; memberId: string } }) {
  const access = await requireEventRole(params.id, "owner");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  await removeCoPlanner(params.memberId);
  await logAudit(params.id, access.user.email, "planner.removed", params.memberId);
  return NextResponse.json({ ok: true });
}
