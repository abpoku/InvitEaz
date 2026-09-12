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

const ROLE_RANK: Record<Role, number> = { viewer: 0, admin: 1, owner: 2 };

export async function requireEventRole(eventId: string, minRole: Role) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, status: 401, message: "Sign in required." };
  const membership = await getMembership(eventId, user.id);
  if (!membership) return { ok: false as const, status: 403, message: "You don't have access to this event." };
  if (ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
    return { ok: false as const, status: 403, message: "You don't have permission to do this." };
  }
  return { ok: true as const, user, role: membership.role };
}
