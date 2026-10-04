"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";

interface MergeGroup { id: string; name: string; assembly_id: string | null; members: string[] }

/** Combines duplicate groups into one household. The planner picks which group to keep (its name and
 * RSVP link survive); everyone else's members and payments move into it, and the other groups'
 * links keep working by pointing at the kept group. */
export function MergeGroupsModal({
  eventId, groups, onClose, onMerged,
}: {
  eventId: string;
  groups: MergeGroup[];
  onClose: () => void;
  onMerged: () => void;
}) {
  // Default to the biggest household (then the first listed) — usually the "real" one.
  const [targetId, setTargetId] = useState(() => [...groups].sort((a, b) => b.members.length - a.members.length)[0]?.id || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mixedClones = new Set(groups.map((g) => g.assembly_id || "")).size > 1;
  const total = groups.reduce((sum, g) => sum + g.members.length, 0);
  const target = groups.find((g) => g.id === targetId);

  async function merge() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/events/${eventId}/groups/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetGroupId: targetId, groupIds: groups.map((g) => g.id) }),
      });
      let data: any = {};
      try { data = await res.json(); } catch {}
      if (!res.ok) return setError(data.error || "Something went wrong. Please try again.");
      onMerged();
    } catch {
      setError("We couldn't reach the server just now. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Merge ${groups.length} groups`} onClose={onClose}>
      <div className="space-y-4">
        {error && <div className="rounded border border-clay-500/30 bg-clay-500/5 text-clay-600 text-sm px-3 py-2.5">{error}</div>}
        {mixedClones ? (
          <p className="text-sm text-clay-600">These groups belong to different clones, so they can&apos;t be merged. Select groups from the same clone.</p>
        ) : (
          <>
            <fieldset>
              <legend className="label">Keep which group&apos;s name and link?</legend>
              <div className="space-y-2">
                {groups.map((g) => (
                  <label
                    key={g.id}
                    className={`flex items-start gap-2.5 rounded border px-3 py-2 text-sm cursor-pointer ${targetId === g.id ? "border-wine-500 bg-wine-50" : "border-paper-line"}`}
                  >
                    <input type="radio" name="merge-target" className="mt-0.5" checked={targetId === g.id} onChange={() => setTargetId(g.id)} />
                    <span className="min-w-0">
                      <span className="text-ink">{g.name}</span>
                      <span className="text-ink-faint"> · {g.members.length} member{g.members.length === 1 ? "" : "s"}</span>
                      {g.members.length > 0 && <span className="block text-xs text-ink-faint truncate">{g.members.join(", ")}</span>}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="text-sm text-ink-soft">
              All {total} member{total === 1 ? "" : "s"} will be in <strong className="text-ink">{target?.name}</strong>. Payments recorded to any of
              these groups move with them, and group links you&apos;ve already sent keep working.
            </p>
          </>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="button" onClick={merge} disabled={saving || mixedClones || !targetId} className="btn-primary">
            {saving ? "Merging…" : "Merge groups"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
