"use client";

import { cn } from "@/lib/utils";

export function ViewToggle({ value, onChange }: { value: "individual" | "group"; onChange: (v: "individual" | "group") => void }) {
  return (
    <div className="inline-flex rounded border border-paper-line overflow-hidden text-sm">
      {(["individual", "group"] as const).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={cn(
            "px-3 py-1.5 capitalize",
            value === v ? "bg-wine-50 text-wine-700 font-medium" : "text-ink-soft hover:bg-paper-soft"
          )}
        >
          {v}
        </button>
      ))}
    </div>
  );
}
