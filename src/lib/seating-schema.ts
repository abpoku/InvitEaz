import { z } from "zod";

/** Request body for one floor item (POST /seating/items; PATCH takes a partial without `kind`). */
export const seatingItemSchema = z.object({
  kind: z.enum(["table", "fixture"]),
  shape: z.string(),
  label: z.string().trim().min(1, "Give it a name.").max(60),
  capacity: z.number().int().min(0).max(500).nullable().optional(),
  assembly_id: z.string().nullable().optional(),
  x: z.number().min(0).max(20000),
  y: z.number().min(0).max(20000),
  width: z.number().min(20).max(3000),
  height: z.number().min(20).max(3000),
  rotation: z.number().min(-360).max(360).optional(),
});
