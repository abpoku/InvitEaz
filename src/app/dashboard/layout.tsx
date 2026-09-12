import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { PLAN_LIMITS } from "@/lib/models/users";
import { initials } from "@/lib/utils";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard");

  return (
    <DashboardShell
      userInitials={initials(user.first_name, user.last_name)}
      userName={`${user.first_name} ${user.last_name}`}
      planLabel={PLAN_LIMITS[user.plan].label}
    >
      {children}
    </DashboardShell>
  );
}
