"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface AssemblyStats { invited: number; attending: number; declined: number; noResponse: number; responseRate: number; }
interface Assembly { id: string; name: string; stats?: AssemblyStats; }
interface Member { id: string; role: string; status: string; invited_email: string; email: string | null; assembly_id: string | null; }

export function AssembliesManager({
  eventId, canManage, isOwner, initialAssemblies, initialMembers,
}: { eventId: string; canManage: boolean; isOwner: boolean; initialAssemblies: Assembly[]; initialMembers: Member[] }) {
  const router = useRouter();
  const [assemblies, setAssemblies] = useState<Assembly[]>(initialAssemblies);
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [aRes, mRes] = await Promise.all([
      fetch(`/api/events/${eventId}/assemblies?stats=1`),
      fetch(`/api/events/${eventId}/members`),
    ]);
    if (aRes.ok) setAssemblies((await aRes.json()).assemblies || []);
    if (mRes.ok) setMembers((await mRes.json()).members || []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  async function createAssembly(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!newName.trim()) return;
    setCreating(true);
    const res = await fetch(`/api/events/${eventId}/assemblies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    setCreating(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Something went wrong.");
      return;
    }
    setNewName("");
    load();
    router.refresh();
  }

  async function renameAssembly(id: string, name: string) {
    await fetch(`/api/events/${eventId}/assemblies/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    load();
  }

  async function deleteAssembly(assembly: Assembly) {
    if (!confirm(`Delete clone "${assembly.name}"? Its lead planner will lose access, and its invitees stay on the guest list but become unassigned. This can't be undone.`)) return;
    await fetch(`/api/events/${eventId}/assemblies/${assembly.id}`, { method: "DELETE" });
    load();
    router.refresh();
  }

  async function assignLeadPlanner(assemblyId: string, email: string) {
    setError(null);
    const res = await fetch(`/api/events/${eventId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role: "lead_planner", assemblyId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Something went wrong.");
      return;
    }
    load();
    router.refresh();
  }

  async function removeMember(memberId: string) {
    if (!confirm("Remove this lead planner's access?")) return;
    await fetch(`/api/events/${eventId}/members/${memberId}`, { method: "DELETE" });
    load();
    router.refresh();
  }

  return (
    <div className="card p-6">
      <h2 className="font-serif text-xl text-ink">Clones</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Split this event's guest list among distinct clones, each with its own lead planner who
        only sees and manages their own invitees, messages, and reports.
      </p>

      {error && <div className="mt-4 rounded border border-clay-500/30 bg-clay-500/5 text-clay-600 text-sm px-3 py-2.5">{error}</div>}

      <div className="mt-6 space-y-3">
        {assemblies.length === 0 ? (
          <p className="text-sm text-ink-faint">No clones yet — everyone on the guest list is unassigned.</p>
        ) : (
          assemblies.map((a) => (
            <AssemblyCard
              key={a.id}
              assembly={a}
              leadPlanner={members.find((m) => m.assembly_id === a.id) || null}
              canManage={canManage}
              canAssign={isOwner}
              onRename={(name) => renameAssembly(a.id, name)}
              onDelete={() => deleteAssembly(a)}
              onAssign={(email) => assignLeadPlanner(a.id, email)}
              onRemoveLeadPlanner={(memberId) => removeMember(memberId)}
            />
          ))
        )}
      </div>

      {canManage && (
        <form onSubmit={createAssembly} className="mt-6 flex items-end gap-2">
          <div className="flex-1">
            <label className="label">New clone name</label>
            <input className="input" placeholder="e.g. North Congregation" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
          <button type="submit" disabled={creating} className="btn-primary shrink-0">{creating ? "Adding…" : "+ Add clone"}</button>
        </form>
      )}
    </div>
  );
}

function AssemblyCard({
  assembly, leadPlanner, canManage, canAssign, onRename, onDelete, onAssign, onRemoveLeadPlanner,
}: {
  assembly: Assembly; leadPlanner: Member | null; canManage: boolean; canAssign: boolean;
  onRename: (name: string) => void; onDelete: () => void; onAssign: (email: string) => void; onRemoveLeadPlanner: (memberId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(assembly.name);
  const [assigning, setAssigning] = useState(false);
  const [email, setEmail] = useState("");

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          {editing ? (
            <form
              onSubmit={(e) => { e.preventDefault(); onRename(name); setEditing(false); }}
              className="flex items-center gap-2"
            >
              <input className="input py-1" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              <button type="submit" className="btn-ghost text-xs">Save</button>
              <button type="button" onClick={() => { setEditing(false); setName(assembly.name); }} className="btn-ghost text-xs">Cancel</button>
            </form>
          ) : (
            <p className="font-serif text-lg text-ink">{assembly.name}</p>
          )}
          {assembly.stats && (
            <p className="mt-1 text-xs text-ink-faint">
              {assembly.stats.invited} invited · {assembly.stats.attending} attending · {assembly.stats.responseRate}% responded
            </p>
          )}
        </div>
        {canManage && !editing && (
          <div className="flex items-center gap-3 shrink-0">
            <button onClick={() => setEditing(true)} className="text-xs text-ink-faint hover:text-ink">Rename</button>
            <button onClick={onDelete} className="text-xs text-ink-faint hover:text-clay-600">Delete</button>
          </div>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-paper-line">
        {leadPlanner ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <p className="text-ink-soft">
              Lead planner: <span className="text-ink">{leadPlanner.email || leadPlanner.invited_email}</span>
              {leadPlanner.status === "pending" && <span className="text-ink-faint"> (invited, awaiting sign-up)</span>}
            </p>
            {canAssign && (
              <button onClick={() => onRemoveLeadPlanner(leadPlanner.id)} className="text-xs text-ink-faint hover:text-clay-600 shrink-0">Remove</button>
            )}
          </div>
        ) : canAssign ? (
          assigning ? (
            <form
              onSubmit={(e) => { e.preventDefault(); onAssign(email); setEmail(""); setAssigning(false); }}
              className="flex items-center gap-2"
            >
              <input type="email" required className="input py-1" placeholder="lead planner's email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
              <button type="submit" className="btn-secondary text-xs shrink-0">Invite</button>
              <button type="button" onClick={() => setAssigning(false)} className="btn-ghost text-xs shrink-0">Cancel</button>
            </form>
          ) : (
            <button onClick={() => setAssigning(true)} className="text-sm text-wine-500 font-medium hover:underline">+ Assign a lead planner</button>
          )
        ) : (
          <p className="text-sm text-ink-faint">No lead planner assigned yet.</p>
        )}
      </div>
    </div>
  );
}
