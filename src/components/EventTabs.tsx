"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/models/events";

const TABS = [
  { href: "", label: "Overview", masterOnly: false },
  { href: "/invitees", label: "Invitees", masterOnly: false },
  { href: "/responses", label: "Responses", masterOnly: false },
  { href: "/messages", label: "Messages", masterOnly: false },
  { href: "/reports", label: "Reports", masterOnly: false },
  { href: "/settings", label: "Settings", masterOnly: true },
];

export function EventTabs({ eventId, role }: { eventId: string; role: Role }) {
  const pathname = usePathname();
  const base = `/dashboard/events/${eventId}`;
  // Clone-scoped roles (lead_planner, co_planner) lose these tabs — existing owner/admin/viewer behavior is unchanged.
  // (Inlined rather than importing isCloneScopedRole from "@/lib/models/events" — that module also
  // exports the pg-backed query helpers, which must never end up in a client bundle.)
  const isCloneScoped = role === "lead_planner" || role === "co_planner";
  const tabs = TABS.filter((t) => !t.masterOnly || !isCloneScoped);

  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {tabs.map((t) => {
        const href = `${base}${t.href}`;
        const active = pathname === href;
        return (
          <Link
            key={t.href}
            href={href}
            className={cn(
              "px-4 py-3 text-sm whitespace-nowrap border-b-2 transition-colors",
              active ? "border-wine-500 text-ink font-medium" : "border-transparent text-ink-soft hover:text-ink hover:border-ink/20"
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
