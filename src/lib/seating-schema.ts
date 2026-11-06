import { z } from "zod";

/** Request body for one floor item (POST /seating/items; PATCH takes a partial without `kind`). */
export const seatingItemSchema = z.object({
  kind: z.enum(["table", "fixture"]),
  shape: z.string(),
  label: z.string().trim().min(1, "Give it a name.").max(200),
  capacity: z.number().int().min(0).max(500).nullable().optional(),
  assembly_id: z.string().nullable().optional(),
  x: z.number().min(-3000).max(20000), // negative only for a rotated item's unrotated corner
  y: z.number().min(-3000).max(20000),
  width: z.number().min(4).max(3000),
  height: z.number().min(4).max(3000),
  rotation: z.number().min(-360).max(360).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a color from the list.").nullable().optional(),
});
