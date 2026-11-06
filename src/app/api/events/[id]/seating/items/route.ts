import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSeatingAccess } from "@/lib/session";
import { getAssembly } from "@/lib/models/assemblies";
import { logAudit } from "@/lib/models/events";
import { createItems, deleteItems, listItems, supersedeStaleRequests, updateItems } from "@/lib/models/seating";
import { shapeDef } from "@/lib/seating";
import { seatingItemSchema } from "@/lib/seating-schema";


const schema = z.object({ items: z.array(seatingItemSchema).min(1).max(200) });
const batchSchema = z.object({
  updates: z.array(seatingItemSchema.omit({ kind: true, shape: true }).partial().extend({ id: z.string() })).min(1).max(500),
});
const deleteSchema = z.object({ ids: z.array(z.string()).min(1).max(500) });

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

/** Several items at once: a group move (mouse or arrow keys) or setting aside a selection of tables
 * for a clone. Every id must be an item of this event; clones only apply to tables. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const access = await requireSeatingAccess(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  if (!access.canEditLayout) return NextResponse.json({ error: "Only the event owner or an admin can change the floor plan." }, { status: 403 });

  const parsed = batchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const items = new Map((await listItems(params.id)).map((i) => [i.id, i]));
  const assemblyIds = new Set<string>();
  for (const u of parsed.data.updates) {
    const item = items.get(u.id);
    if (!item) return NextResponse.json({ error: "Some of these items no longer exist. Refresh and try again." }, { status: 404 });
    if (item.kind === "fixture") { delete u.capacity; delete u.assembly_id; }
    if (u.assembly_id) assemblyIds.add(u.assembly_id);
  }
  for (const a of assemblyIds) {
    const asm = await getAssembly(a);
    if (!asm || asm.event_id !== params.id) return NextResponse.json({ error: "That clone doesn't exist." }, { status: 400 });
  }
  await updateItems(params.id, parsed.data.updates);
  if (parsed.data.updates.some((u) => "assembly_id" in u)) {
    await supersedeStaleRequests(params.id);
    await logAudit(params.id, access.user.email, "seating.table_set_aside", `${parsed.data.updates.length} table(s)`);
  }
  return NextResponse.json({ ok: true });
}

/** Delete several items; their guests become unseated. */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const access = await requireSeatingAccess(params.id);
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.status });
  if (!access.canEditLayout) return NextResponse.json({ error: "Only the event owner or an admin can change the floor plan." }, { status: 403 });
  const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const items = await listItems(params.id);
  const doomed = items.filter((i) => parsed.data.ids.includes(i.id));
  await deleteItems(params.id, doomed.map((i) => i.id));
  if (doomed.length) await logAudit(params.id, access.user.email, "seating.item_deleted", doomed.map((i) => i.label).join(", "));
  return NextResponse.json({ deleted: doomed.length });
}
