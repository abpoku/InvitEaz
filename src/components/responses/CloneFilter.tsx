"use client";

import { useRouter } from "next/navigation";

interface Clone { id: string; name: string; }

export function CloneFilter({ clones, current }: { clones: Clone[]; current: string }) {
  const router = useRouter();
  return (
    <select
      className="input max-w-[200px]"
      value={current}
      onChange={(e) => {
        const value = e.target.value;
        router.push(value ? `?clone=${value}` : "?");
      }}
    >
      <option value="">All clones</option>
      {clones.map((c) => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </select>
  );
}
