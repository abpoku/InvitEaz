"use client";

import { useEffect } from "react";

/** On phones this is a bottom sheet (full width, up to nearly the full height, `dvh` so the iOS
 * address bar and keyboard don't hide its bottom); from `sm` up it's the centered dialog. */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  // Keep the page behind the sheet from scrolling while it's open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/40 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`bg-paper rounded-t-xl sm:rounded-lg shadow-lifted w-full ${wide ? "sm:max-w-2xl" : "sm:max-w-md"} max-h-[92dvh] sm:max-h-[85vh] overflow-y-auto overscroll-contain animate-rise pb-[env(safe-area-inset-bottom)]`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pl-4 pr-2 sm:pl-6 sm:pr-4 py-2 sm:py-3 border-b border-paper-line sticky top-0 z-10 bg-paper">
          <h2 className="font-serif text-lg text-ink">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="h-11 w-11 flex items-center justify-center text-ink-faint hover:text-ink text-2xl leading-none">×</button>
        </div>
        <div className="p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
}
