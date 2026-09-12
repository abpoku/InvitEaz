"use client";

import { useState } from "react";
import Link from "next/link";
import { EnvelopeMark } from "@/components/EnvelopeMark";
import { SignOutButton } from "@/components/SignOutButton";

export function DashboardShell({
  children,
  userInitials,
  userName,
  planLabel,
}: {
  children: React.ReactNode;
  userInitials: string;
  userName: string;
  planLabel: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-paper md:flex">
      {/* Mobile top bar */}
      <div className="md:hidden flex items-center justify-between h-14 px-4 border-b border-paper-line">
        <Link href="/dashboard" className="flex items-center gap-2">
          <EnvelopeMark className="w-6 h-4" />
          <span className="font-serif text-lg text-ink">InvitEaz</span>
        </Link>
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="p-2 -mr-2 text-ink-soft hover:text-ink"
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 6h16M3 11h16M3 16h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 max-w-[80vw] bg-paper border-r border-paper-line flex flex-col animate-rise">
            <div className="h-14 flex items-center justify-between px-4 border-b border-paper-line">
              <Link href="/dashboard" className="flex items-center gap-2" onClick={() => setOpen(false)}>
                <EnvelopeMark className="w-6 h-4" />
                <span className="font-serif text-lg text-ink">InvitEaz</span>
              </Link>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="p-2 -mr-2 text-ink-faint hover:text-ink text-xl leading-none"
              >
                ×
              </button>
            </div>
            <nav className="flex-1 px-3 py-5 space-y-0.5">
              <SidebarLink href="/dashboard" onClick={() => setOpen(false)}>Dashboard</SidebarLink>
              <SidebarLink href="/dashboard/events/new" onClick={() => setOpen(false)}>+ New event</SidebarLink>
            </nav>
            <UserBlock userInitials={userInitials} userName={userName} planLabel={planLabel} />
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 border-r border-paper-line flex-col">
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
        <UserBlock userInitials={userInitials} userName={userName} planLabel={planLabel} />
      </aside>

      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}

function SidebarLink({ href, children, onClick }: { href: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <Link href={href} onClick={onClick} className="block rounded px-3 py-2 text-sm text-ink-soft hover:bg-ink/[0.04] hover:text-ink">
      {children}
    </Link>
  );
}

function UserBlock({ userInitials, userName, planLabel }: { userInitials: string; userName: string; planLabel: string }) {
  return (
    <div className="px-4 py-4 border-t border-paper-line">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-full bg-wine-100 text-wine-600 flex items-center justify-center text-xs font-medium shrink-0">
          {userInitials}
        </div>
        <div className="min-w-0">
          <p className="text-sm text-ink truncate">{userName}</p>
          <p className="text-xs text-ink-faint">{planLabel} plan</p>
        </div>
      </div>
      <SignOutButton className="mt-3 text-xs text-ink-faint hover:text-ink" />
    </div>
  );
}
