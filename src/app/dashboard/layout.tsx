import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { PLAN_LIMITS } from "@/lib/models/users";
import { listEventsForUser, activeEventsUsed } from "@/lib/models/events";
import { initials } from "@/lib/utils";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard");
  const limits = PLAN_LIMITS[user.plan];

  return (
    <DashboardShell
      userInitials={initials(user.first_name, user.last_name)}
      userName={`${user.first_name} ${user.last_name}`}
      userEmail={user.email}
      planLabel={limits.label}
      eventsUsed={activeEventsUsed(await listEventsForUser(user.id))}
      eventsLimit={limits.activeEvents}
    >
      {children}
    </DashboardShell>
  );
}
