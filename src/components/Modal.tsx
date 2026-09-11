"use client";

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <div
        className={`bg-paper rounded-lg shadow-lifted w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[85vh] overflow-y-auto animate-rise`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-paper-line sticky top-0 bg-paper">
          <h2 className="font-serif text-lg text-ink">{title}</h2>
          <button onClick={onClose} className="text-ink-faint hover:text-ink text-xl leading-none">×</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
