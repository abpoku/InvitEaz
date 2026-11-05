"use client";

import { usePathname } from "next/navigation";

/** The centered column every signed-in page shares (top bar, event header and tabs, page body), so
 * their edges line up. Pages narrower than this (forms, Reports) center themselves inside it. */
export const FRAME = "mx-auto w-full max-w-6xl";

/** Tabs whose tables (or the seating floor plan) use the whole screen. On these the top bar and event header go full width too,
 * so their edges still line up with the table. */
const FULL_WIDTH = /^\/dashboard\/events\/[^/]+\/(invitees|tickets|seating)$/;

/** Wraps the top bar's and the event header's contents: the shared column, or full width on the
 * full-width tabs. */
export function PageFrame({ className = "", children }: { className?: string; children: React.ReactNode }) {
  const wide = FULL_WIDTH.test(usePathname());
  return <div className={`${wide ? "" : FRAME} ${className}`}>{children}</div>;
}
