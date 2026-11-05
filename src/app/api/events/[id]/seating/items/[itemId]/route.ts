import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSeatingAccess } from "@/lib/session";
import { getAssembly } from "@/lib/models/assemblies";
import { logAudit } from "@/lib/models/events";
import { deleteItem, getItem, supersedeStaleRequests, updateItem } from "@/lib/models/seating";
import { shapeDef } from "@/lib/seating";
import { seatingItemSchema } from "@/lib/seating-schema";

const patchSchema = seatingItemSchema.omit({ kind: true }).partial();

async function gate(eventId: string, itemId: string) {
  const access = await requireSeatingAccess(eventId);
  if (!access.ok) return { error: NextResponse.json({ error: access.message }, { status: access.status }) };
  if (!access.canEditLayout) return { error: NextResponse.json({ error: "Only the event owner or an admin can change the floor plan." }, { status: 403 }) };
  const item = await getItem(itemId);
  if (!item || item.event_id !== eventId) return { error: NextResponse.json({ error: "That item no longer exists." }, { status: 404 }) };
  return { access, item };
}

/** Move, resize, rotate, rename, change capacity or the clone a table is set aside for. Lowering a
 * capacity below what's seated is allowed — the table just shows as over. */
export async function PATCH(req: Request, { params }: { params: { id: string; itemId: string } }) {
  const g = await gate(params.id, params.itemId);
  if ("error" in g) return g.error;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const patch = parsed.data;
  if (patch.shape && !shapeDef(g.item.kind, patch.shape)) return NextResponse.json({ error: "Unknown shape." }, { status: 400 });
  if (g.item.kind === "fixture") { delete patch.capacity; delete patch.assembly_id; }
  if (patch.assembly_id) {
    const a = await getAssembly(patch.assembly_id);
    if (!a || a.event_id !== params.id) return NextResponse.json({ error: "That clone doesn't exist." }, { status: 400 });
  }
  await updateItem(params.itemId, patch);
  if ("assembly_id" in patch) {
    await supersedeStaleRequests(params.id);
    await logAudit(params.id, g.access.user.email, "seating.table_set_aside", `${g.item.label} → ${patch.assembly_id || "no clone"}`);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string; itemId: string } }) {
  const g = await gate(params.id, params.itemId);
  if ("error" in g) return g.error;
  await deleteItem(params.id, params.itemId);
  await logAudit(params.id, g.access.user.email, "seating.item_deleted", g.item.label);
  return NextResponse.json({ ok: true });
}
