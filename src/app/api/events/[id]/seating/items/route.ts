import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSeatingAccess } from "@/lib/session";
import { getAssembly } from "@/lib/models/assemblies";
import { logAudit } from "@/lib/models/events";
import { createItems } from "@/lib/models/seating";
import { shapeDef } from "@/lib/seating";
import { seatingItemSchema } from "@/lib/seating-schema";


const schema = z.object({ items: z.array(seatingItemSchema).min(1).max(200) });

/** Add tables/fixtures (one, or a generated batch). Layout is owner/admin only. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const access = await requireSeatingAccess(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  if (!access.canEditLayout) return NextResponse.json({ error: "Only the event owner or an admin can change the floor plan." }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  for (const it of parsed.data.items) {
    if (!shapeDef(it.kind, it.shape)) return NextResponse.json({ error: "Unknown shape." }, { status: 400 });
    if (it.assembly_id) {
      const a = await getAssembly(it.assembly_id);
      if (!a || a.event_id !== params.id) return NextResponse.json({ error: "That clone doesn't exist." }, { status: 400 });
    }
  }
  const items = await createItems(params.id, parsed.data.items.map((it) => ({
    ...it, capacity: it.capacity ?? null, assembly_id: it.assembly_id ?? null, rotation: it.rotation ?? 0,
  })));
  await logAudit(params.id, access.user.email, "seating.items_added", items.map((i) => i.label).join(", "));
  return NextResponse.json({ items });
}
