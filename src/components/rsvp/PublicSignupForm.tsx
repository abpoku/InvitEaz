"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PublicSignupForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.firstName || !form.lastName) {
      setError("Please add your first and last name.");
      return;
    }
    if (!form.email && !form.phone) {
      setError("Add an email or phone number so the organizer can reach you.");
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/e/${slug}/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error || "Something went wrong.");
      return;
    }
    router.push(`/r/${data.token}`);
  }

  return (
    <form onSubmit={submit} className="card p-6 space-y-4">
      {error && <div className="rounded border border-clay-500/30 bg-clay-500/5 text-clay-600 text-sm px-3 py-2.5">{error}</div>}
      <p className="text-sm text-ink-soft">Tell us who you are, and we'll bring up your RSVP.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">First name</label>
          <input className="input" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
        </div>
        <div>
          <label className="label">Last name</label>
          <input className="input" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
        </div>
      </div>
      <div>
        <label className="label">Email</label>
        <input type="email" className="input" value={form.email} onChange={(e) => set("email", e.target.value)} />
      </div>
      <div>
        <label className="label">Phone <span className="text-ink-faint font-normal">(optional)</span></label>
        <input className="input" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
      </div>
      <button type="submit" disabled={saving} className="btn-primary w-full">{saving ? "Continuing…" : "Continue to RSVP"}</button>
    </form>
  );
}
