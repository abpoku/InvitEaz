"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { EnvelopeMark } from "@/components/EnvelopeMark";

/** Every signed-in page: a slim top bar (logo → dashboard, account menu) over the page, the same on
 * phones and desktop. There's no sidebar — its links lived elsewhere already (the logo, "← All events",
 * the dashboard's Create button), and the room goes to the page, mostly the wide Invitees table. */
export function DashboardShell({
  children,
  userInitials,
  userName,
  userEmail,
  planLabel,
  eventsUsed,
  eventsLimit,
}: {
  children: React.ReactNode;
  userInitials: string;
  userName: string;
  userEmail: string;
  planLabel: string;
  eventsUsed: number;
  /** Infinity on unlimited plans. */
  eventsLimit: number;
}) {
  return (
    <div className="min-h-screen bg-paper">
      <header data-print-hide className="h-14 border-b border-paper-line">
        <div className="h-full flex items-center justify-between px-4 sm:px-8">
          <Link href="/dashboard" className="flex items-center gap-2">
            <EnvelopeMark className="w-6 h-4" />
            <span className="font-serif text-lg text-ink">InvitEaz</span>
          </Link>
          <AccountMenu
            userInitials={userInitials} userName={userName} userEmail={userEmail}
            planLabel={planLabel} eventsUsed={eventsUsed} eventsLimit={eventsLimit}
          />
        </div>
      </header>
      <main className="min-w-0">{children}</main>
    </div>
  );
}

/** The avatar button and its menu: who's signed in, their plan and usage, New event, Log out. Closes on
 * an outside click, Escape (focus returns to the button) or navigating. */
function AccountMenu({ userInitials, userName, userEmail, planLabel, eventsUsed, eventsLimit }: {
  userInitials: string; userName: string; userEmail: string; planLabel: string; eventsUsed: number; eventsLimit: number;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); buttonRef.current?.focus(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const usage = eventsLimit === Infinity ? `${planLabel} plan` : `${planLabel} plan · ${eventsUsed} of ${eventsLimit} active events used`;
  const item = "block w-full px-4 py-3 sm:py-2 text-left text-sm text-ink hover:bg-paper-soft focus:bg-paper-soft focus:outline-none";

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${userName}`}
        className="flex h-11 items-center gap-1.5 rounded-full pl-1 pr-2 -mr-2 text-ink-faint hover:text-ink hover:bg-ink/[0.04]"
      >
        <span className="w-8 h-8 rounded-full bg-wine-100 text-wine-600 flex items-center justify-center text-xs font-medium">{userInitials}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none">
          <path d="M2 3.5 5 6.5 8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div role="menu" aria-label="Account" className="absolute right-0 top-full z-40 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-paper-line bg-paper py-1 shadow-lifted">
          <div className="px-4 py-3 border-b border-paper-line">
            <p className="text-sm font-medium text-ink truncate">{userName}</p>
            <p className="text-xs text-ink-faint truncate">{userEmail}</p>
            <p className="mt-2 text-xs text-ink-soft">{usage}</p>
          </div>
          <Link role="menuitem" href="/dashboard/events/new" onClick={() => setOpen(false)} className={item}>+ New event</Link>
          <button role="menuitem" type="button" onClick={() => signOut({ callbackUrl: "/" })} className={item}>Log out</button>
        </div>
      )}
    </div>
  );
}
