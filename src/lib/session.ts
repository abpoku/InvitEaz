import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getUserById } from "@/lib/models/users";
import { getMembership, isCloneScopedRole, type Role } from "@/lib/models/events";

export async function getCurrentUser() {
  const session = await getServerSession(authOptions);
  const id = (session?.user as any)?.id;
  if (!id) return null;
  return (await getUserById(id)) || null;
}

/** For dashboard pages: the signed-in user, or a redirect to login. Next renders a page in parallel
 * with its layout, so the layout's own redirect doesn't stop the page running — a page that assumed a
 * user (`user!`) used to crash with a null-user error in the logs for every signed-out visit. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

// lead_planner and co_planner deliberately have no rank here — both are scoped roles, not a
// point on this ladder, so they must never satisfy a full-event minRole check (see the `?? -1`
// fallback below).
const ROLE_RANK: Partial<Record<Role, number>> = { viewer: 0, admin: 1, owner: 2 };

/** Gates full-event actions (settings, RSVP form, invitee-field config, co-planners, publish/
 * delete). A lead_planner/co_planner's rank is undefined here and always fails this check by
 * design — their access is scoped to one assembly and goes through requireAssemblyScope instead. */
export async function requireEventRole(eventId: string, minRole: Exclude<Role, "lead_planner" | "co_planner">) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, status: 401, message: "Sign in required." };
  const membership = await getMembership(eventId, user.id);
  if (!membership) return { ok: false as const, status: 403, message: "You don't have access to this event." };
  const rank = ROLE_RANK[membership.role] ?? -1;
  if (rank < ROLE_RANK[minRole]!) {
    return { ok: false as const, status: 403, message: "You don't have permission to do this." };
  }
  return { ok: true as const, user, role: membership.role as Exclude<Role, "lead_planner" | "co_planner"> };
}

/** Gates assembly-scoped actions (invitees, groups, messages, responses/reports). Full-event
 * roles (owner/admin/viewer) get unrestricted access (`assemblyId: null` = no filter); a
 * lead_planner or co_planner is confined to the one assembly their membership names. */
export async function requireAssemblyScope(eventId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, status: 401, message: "Sign in required." };
  const membership = await getMembership(eventId, user.id);
  if (!membership) return { ok: false as const, status: 403, message: "You don't have access to this event." };
  if (isCloneScopedRole(membership.role) && !membership.assembly_id) {
    return { ok: false as const, status: 403, message: "Your access to this event isn't set up correctly. Contact the event owner." };
  }
  return {
    ok: true as const,
    user,
    role: membership.role,
    assemblyId: isCloneScopedRole(membership.role) ? membership.assembly_id! : null,
  };
}
