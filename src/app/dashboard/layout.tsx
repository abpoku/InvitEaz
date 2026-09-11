import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { EnvelopeMark } from "@/components/EnvelopeMark";
import { SignOutButton } from "@/components/SignOutButton";
import { PLAN_LIMITS } from "@/lib/models/users";
import { initials } from "@/lib/utils";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard");

  return (
    <div className="min-h-screen bg-paper flex">
      <aside className="w-60 shrink-0 border-r border-paper-line flex flex-col">
        <div className="h-16 flex items-center px-5 border-b border-paper-line">
          <Link href="/dashboard" className="flex items-center gap-2">
            <EnvelopeMark className="w-6 h-4" />
            <span className="font-serif text-lg text-ink">InvitEaz</span>
          </Link>
        </div>
        <nav className="flex-1 px-3 py-5 space-y-0.5">
          <SidebarLink href="/dashboard">Dashboard</SidebarLink>
          <SidebarLink href="/dashboard/events/new">+ New event</SidebarLink>
        </nav>
        <div className="px-4 py-4 border-t border-paper-line">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-wine-100 text-wine-600 flex items-center justify-center text-xs font-medium">
              {initials(user.first_name, user.last_name)}
            </div>
            <div className="min-w-0">
              <p className="text-sm text-ink truncate">{user.first_name} {user.last_name}</p>
              <p className="text-xs text-ink-faint">{PLAN_LIMITS[user.plan].label} plan</p>
            </div>
          </div>
          <SignOutButton className="mt-3 text-xs text-ink-faint hover:text-ink" />
        </div>
      </aside>
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}

function SidebarLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="block rounded px-3 py-2 text-sm text-ink-soft hover:bg-ink/[0.04] hover:text-ink">
      {children}
    </Link>
  );
}
