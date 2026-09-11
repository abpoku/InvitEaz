"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "", label: "Overview" },
  { href: "/invitees", label: "Invitees" },
  { href: "/rsvp-form", label: "RSVP form" },
  { href: "/responses", label: "Responses" },
  { href: "/messages", label: "Messages" },
  { href: "/reports", label: "Reports" },
  { href: "/settings", label: "Settings" },
];

export function EventTabs({ eventId }: { eventId: string }) {
  const pathname = usePathname();
  const base = `/dashboard/events/${eventId}`;

  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {TABS.map((t) => {
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
