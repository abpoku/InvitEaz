import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEventRole, requireAssemblyScope } from "@/lib/session";
import { createAssembly, listAssemblies, countAssemblies, getAssemblyStats } from "@/lib/models/assemblies";
import { getEventById, logAudit } from "@/lib/models/events";
import { getUserById, PLAN_LIMITS } from "@/lib/models/users";

const schema = z.object({ name: z.string().min(1) });

export async function GET(req: Request, { params }: { params: { id: string } }) {
  // Read access is open to any full-scope member (owner/admin/viewer) so the invitees UI can
  // offer an assembly filter; a lead planner never needs the full list, so they're excluded.
  const access = await requireAssemblyScope(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  if (access.assemblyId) return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });
  const assemblies = await listAssemblies(params.id);

  // Stats cost an extra query per assembly — only compute them when the caller actually wants
  // them (the Assemblies management page), not for the many places that just need {id, name}.
  const withStats = new URL(req.url).searchParams.get("stats") === "1";
  if (!withStats) return NextResponse.json({ assemblies });
  const assembliesWithStats = await Promise.all(assemblies.map(async (a) => ({ ...a, stats: await getAssemblyStats(params.id, a.id) })));
  return NextResponse.json({ assemblies: assembliesWithStats });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const access = await requireEventRole(params.id, "admin");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });

  const event = await getEventById(params.id);
  if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

  const owner = (await getUserById(event.owner_id))!;
  const limit = PLAN_LIMITS[owner.plan].assembliesPerEvent;
  if ((await countAssemblies(params.id)) >= limit) {
    return NextResponse.json({ error: `Your plan allows up to ${limit} clone${limit === 1 ? "" : "s"} per event. Upgrade to add more.` }, { status: 402 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const assembly = await createAssembly(params.id, parsed.data.name);
  await logAudit(params.id, access.user.email, "assembly.added", assembly.name);
  return NextResponse.json({ assembly });
}
