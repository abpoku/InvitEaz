"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/models/events";

const TABS = [
  { href: "", label: "Overview", masterOnly: false },
  { href: "/invitees", label: "Invitees", masterOnly: false },
  { href: "/tickets", label: "Tickets", masterOnly: false },
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

  // On a phone the tabs scroll sideways. Bring the active one into view (Tickets, Messages… start
  // off-screen otherwise), and fade the edge that has more tabs beyond it.
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  function measure() {
    const el = scroller.current;
    if (!el) return;
    setMore({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }
  useEffect(() => {
    const el = scroller.current;
    const active = el?.querySelector<HTMLElement>("[aria-current=page]");
    // Set scrollLeft directly rather than scrollIntoView, which can also scroll the page vertically.
    if (el && active && (active.offsetLeft < el.scrollLeft || active.offsetLeft + active.offsetWidth > el.scrollLeft + el.clientWidth)) {
      el.scrollLeft = active.offsetLeft - 16;
    }
    measure();
  }, [pathname]);
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const fade = "pointer-events-none absolute inset-y-0 w-8 from-paper to-transparent transition-opacity";
  return (
    <div className="relative">
    <div className={`${fade} left-0 bg-gradient-to-r z-10 ${more.left ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />
    <div className={`${fade} right-0 bg-gradient-to-l z-10 ${more.right ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />
    <div ref={scroller} onScroll={measure} className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((t) => {
        const href = `${base}${t.href}`;
        const active = pathname === href;
        return (
          <Link
            key={t.href}
            href={href}
            aria-current={active ? "page" : undefined}
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
    </div>
  );
}
