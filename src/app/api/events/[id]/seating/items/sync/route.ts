import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSeatingAccess } from "@/lib/session";
import { getAssembly } from "@/lib/models/assemblies";
import { logAudit } from "@/lib/models/events";
import { SeatingError, syncItems } from "@/lib/models/seating";
import { shapeDef } from "@/lib/seating";
import { seatingItemSchema } from "@/lib/seating-schema";

const schema = z.object({
  upsert: z.array(seatingItemSchema.extend({ id: z.string().regex(/^seat_[0-9a-f]{32}$/) })).max(500),
  delete: z.array(z.string()).max(500),
});

/** Undo/redo for the floor plan: restore items to an earlier state (same ids, all fields) and remove
 * the ones that didn't exist then. Layout is owner/admin only, same as every other layout write. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const access = await requireSeatingAccess(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  if (!access.canEditLayout) return NextResponse.json({ error: "Only the event owner or an admin can change the floor plan." }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  for (const it of parsed.data.upsert) {
    if (!shapeDef(it.kind, it.shape)) return NextResponse.json({ error: "Unknown shape." }, { status: 400 });
    if (it.assembly_id) {
      const a = await getAssembly(it.assembly_id);
      // The clone may have been deleted since; restore the table without it rather than failing.
      if (!a || a.event_id !== params.id) it.assembly_id = null;
    }
  }
  try {
    await syncItems(params.id, parsed.data.upsert.map((it) => ({
      ...it, capacity: it.capacity ?? null, assembly_id: it.assembly_id ?? null, rotation: it.rotation ?? 0, color: it.color ?? null,
    })), parsed.data.delete);
  } catch (err) {
    if (err instanceof SeatingError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
  await logAudit(params.id, access.user.email, "seating.layout_restored", `${parsed.data.upsert.length} restored, ${parsed.data.delete.length} removed`);
  return NextResponse.json({ ok: true });
}
