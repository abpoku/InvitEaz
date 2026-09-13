"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface SignupField {
  key: string;
  label: string;
  kind: "core" | "custom";
  field_type: "text" | "email" | "phone" | "number" | "date" | "dropdown" | "checkbox";
  options_json: string | null;
  required: number;
}

export function PublicSignupForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [fields, setFields] = useState<SignupField[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [nameFormat, setNameFormat] = useState<"first_last" | "full">("first_last");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function loadFields() {
    setLoadError(false);
    setFields(null);
    fetch(`/api/e/${slug}/fields`)
      .then((r) => {
        if (!r.ok) throw new Error("failed");
        return r.json();
      })
      .then((data) => {
        setFields(data.fields || []);
        setNameFormat(data.nameFormat || "first_last");
      })
      .catch(() => setLoadError(true));
  }

  useEffect(loadFields, [slug]);

  function setValue(key: string, v: string) {
    setValues((s) => ({ ...s, [key]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!firstName.trim() || (nameFormat === "first_last" && !lastName.trim())) {
      setError(nameFormat === "full" ? "Please add your name." : "Please add your first and last name.");
      return;
    }
    const emailActive = fields?.some((f) => f.key === "email");
    const phoneActive = fields?.some((f) => f.key === "phone");
    if ((emailActive || phoneActive) && !values.email && !values.phone) {
      setError("Add an email or phone number so the organizer can reach you.");
      return;
    }
    for (const f of fields || []) {
      if (f.required && !values[f.key]) {
        setError(`Please answer: ${f.label}`);
        return;
      }
    }

    setSaving(true);
    const customFields: Record<string, string> = {};
    for (const f of fields || []) {
      if (f.kind === "custom" && values[f.key]) customFields[f.key] = values[f.key];
    }
    const res = await fetch(`/api/e/${slug}/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: firstName.trim(),
        lastName: nameFormat === "full" ? "" : lastName.trim(),
        email: values.email,
        phone: values.phone,
        group: values.group || undefined,
        isAdult: values.is_adult ? values.is_adult !== "Child" : undefined,
        plusOnePolicy: (values.plus_one_policy as any) || undefined,
        notes: values.notes || undefined,
        customFields: Object.keys(customFields).length ? customFields : undefined,
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error || "Something went wrong.");
      return;
    }
    router.push(`/r/${data.token}`);
  }

  if (loadError) {
    return (
      <div className="card p-6 text-center">
        <p className="text-sm text-ink-soft">We couldn't load the sign-up form.</p>
        <button onClick={loadFields} className="btn-secondary mt-3">Try again</button>
      </div>
    );
  }

  if (!fields) {
    return <div className="card p-6 text-sm text-ink-faint text-center">Loading…</div>;
  }

  return (
    <form onSubmit={submit} className="card p-6 space-y-4">
      {error && <div className="rounded border border-clay-500/30 bg-clay-500/5 text-clay-600 text-sm px-3 py-2.5">{error}</div>}
      <p className="text-sm text-ink-soft">Tell us who you are, and we'll bring up your RSVP.</p>

      {nameFormat === "full" ? (
        <div>
          <label className="label">Full name</label>
          <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">First name</label>
            <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div>
            <label className="label">Last name</label>
            <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
        </div>
      )}

      {fields.map((f) => {
        const label = (
          <label className="label">{f.label} {f.required ? null : <span className="text-ink-faint font-normal">(optional)</span>}</label>
        );

        if (f.key === "is_adult") {
          return (
            <div key={f.key}>
              {label}
              <select className="input" value={values.is_adult || "Adult"} onChange={(e) => setValue("is_adult", e.target.value)}>
                <option value="Adult">Adult</option>
                <option value="Child">Child</option>
              </select>
            </div>
          );
        }
        if (f.key === "plus_one_policy") {
          return (
            <div key={f.key}>
              {label}
              <select className="input" value={values.plus_one_policy || ""} onChange={(e) => setValue("plus_one_policy", e.target.value)}>
                <option value="">Use event default</option>
                <option value="none">No plus-ones</option>
                <option value="one">May bring one</option>
                <option value="multiple">May bring multiple</option>
              </select>
            </div>
          );
        }
        if (f.field_type === "dropdown") {
          const options: string[] = f.options_json ? JSON.parse(f.options_json) : [];
          return (
            <div key={f.key}>
              {label}
              <select className="input" value={values[f.key] || ""} onChange={(e) => setValue(f.key, e.target.value)}>
                <option value="">Choose…</option>
                {options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          );
        }
        if (f.field_type === "checkbox") {
          return (
            <label key={f.key} className="flex items-center gap-2.5 text-sm text-ink-soft">
              <input type="checkbox" checked={values[f.key] === "yes"} onChange={(e) => setValue(f.key, e.target.checked ? "yes" : "")} />
              {f.label}
            </label>
          );
        }
        const inputType = f.field_type === "email" ? "email" : f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : "text";
        return (
          <div key={f.key}>
            {label}
            <input type={inputType} className="input" value={values[f.key] || ""} onChange={(e) => setValue(f.key, e.target.value)} />
          </div>
        );
      })}

      <button type="submit" disabled={saving} className="btn-primary w-full">{saving ? "Continuing…" : "Continue to RSVP"}</button>
    </form>
  );
}
