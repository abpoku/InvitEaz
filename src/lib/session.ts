import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getUserById } from "@/lib/models/users";
import { getMembership, type Role } from "@/lib/models/events";

export async function getCurrentUser() {
  const session = await getServerSession(authOptions);
  const id = (session?.user as any)?.id;
  if (!id) return null;
  return (await getUserById(id)) || null;
}

// lead_planner deliberately has no rank here — it's a scoped role, not a point on this ladder,
// so it must never satisfy a full-event minRole check (see the `?? -1` fallback below).
const ROLE_RANK: Partial<Record<Role, number>> = { viewer: 0, admin: 1, owner: 2 };

/** Gates full-event actions (settings, RSVP form, invitee-field config, co-planners, publish/
 * delete). A lead_planner's rank is undefined here and always fails this check by design —
 * their access is scoped to one assembly and goes through requireAssemblyScope instead. */
export async function requireEventRole(eventId: string, minRole: Exclude<Role, "lead_planner">) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, status: 401, message: "Sign in required." };
  const membership = await getMembership(eventId, user.id);
  if (!membership) return { ok: false as const, status: 403, message: "You don't have access to this event." };
  const rank = ROLE_RANK[membership.role] ?? -1;
  if (rank < ROLE_RANK[minRole]!) {
    return { ok: false as const, status: 403, message: "You don't have permission to do this." };
  }
  return { ok: true as const, user, role: membership.role as Exclude<Role, "lead_planner"> };
}

/** Gates assembly-scoped actions (invitees, groups, messages, responses/reports). Full-event
 * roles (owner/admin/viewer) get unrestricted access (`assemblyId: null` = no filter); a
 * lead_planner is confined to the one assembly their membership names. */
export async function requireAssemblyScope(eventId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, status: 401, message: "Sign in required." };
  const membership = await getMembership(eventId, user.id);
  if (!membership) return { ok: false as const, status: 403, message: "You don't have access to this event." };
  if (membership.role === "lead_planner" && !membership.assembly_id) {
    return { ok: false as const, status: 403, message: "Your access to this event isn't set up correctly. Contact the event owner." };
  }
  return {
    ok: true as const,
    user,
    role: membership.role,
    assemblyId: membership.role === "lead_planner" ? membership.assembly_id! : null,
  };
}
