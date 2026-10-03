"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface KebabItem {
  label: string;
  onSelect: () => void;
}

/** A "⋮" row-actions menu. The panel is position: fixed (measured from the button) rather than
 * absolute, because these live inside `overflow-x-auto` table cards that would otherwise clip it —
 * and it flips upward when there isn't room below (the last rows of a long table). */
export function KebabMenu({ label, items }: { label: string; items: KebabItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /** Pins the panel to the button. Returns false once the button has scrolled out of view. */
  function place(): boolean {
    if (!buttonRef.current) return false;
    const rect = buttonRef.current.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return false;
    const menuHeight = menuRef.current?.offsetHeight || items.length * 36 + 8;
    const below = rect.bottom + 4;
    const top = below + menuHeight > window.innerHeight - 8 ? Math.max(8, rect.top - 4 - menuHeight) : below;
    setPos({ top, right: Math.max(8, window.innerWidth - rect.right) });
    return true;
  }

  useLayoutEffect(() => {
    if (!open) return;
    place();
    // preventScroll: focusing must never scroll the page or the table under the menu.
    menuRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    // Follow the button while the page or a horizontally-scrolling table moves (phones scroll the
    // table sideways to reach this column); only close once the button itself is out of view.
    const follow = () => { if (!place()) close(); };
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { close(); buttonRef.current?.focus(); }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [open]);

  function onMenuKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const els = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") || [])];
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    els[(i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length]?.focus();
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-8 w-8 items-center justify-center rounded text-ink-faint hover:text-ink hover:bg-paper-soft"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
          <circle cx="8" cy="3" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="8" cy="13" r="1.5" />
        </svg>
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          style={{ position: "fixed", top: pos?.top ?? -9999, right: pos?.right ?? 0 }}
          className="z-40 min-w-[180px] rounded-md border border-paper-line bg-paper py-1 shadow-lifted text-left"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); item.onSelect(); }}
              className="block w-full px-3.5 py-2 text-left text-sm text-ink hover:bg-paper-soft focus:bg-paper-soft focus:outline-none"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
