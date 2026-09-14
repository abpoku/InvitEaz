"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { validateRecords, findDuplicateRowNumbers, type MappedInviteeRow } from "@/lib/invitee-field-matching";
import type { InviteeField, Assembly } from "@/components/invitees/InviteesManager";

interface PreviewResult {
  total: number; validCount: number; invalidCount: number; duplicateCount: number;
  valid: MappedInviteeRow[]; invalid: MappedInviteeRow[]; duplicates: MappedInviteeRow[];
}

function buildPreview(rows: MappedInviteeRow[]): PreviewResult {
  const dupeRowNumbers = findDuplicateRowNumbers(rows);
  const withDupes = rows.map((r) => ({ ...r, isDuplicate: dupeRowNumbers.has(r.rowNumber) }));
  const valid = withDupes.filter((r) => r.errors.length === 0 && !r.isDuplicate);
  const invalid = withDupes.filter((r) => r.errors.length > 0);
  const duplicates = withDupes.filter((r) => r.isDuplicate && r.errors.length === 0);
  return { total: rows.length, validCount: valid.length, invalidCount: invalid.length, duplicateCount: duplicates.length, valid, invalid, duplicates };
}

export function UploadModal({ eventId, onClose, onImported }: { eventId: string; onClose: () => void; onImported: () => void }) {
  const [step, setStep] = useState<"select" | "map" | "preview" | "done">("select");
  const [headers, setHeaders] = useState<string[]>([]);
  const [records, setRecords] = useState<Record<string, any>[]>([]);
  const [fields, setFields] = useState<InviteeField[]>([]);
  const [nameFormat, setNameFormat] = useState<"first_last" | "full">("first_last");
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [assemblies, setAssemblies] = useState<Assembly[]>([]);
  const [assemblyId, setAssemblyId] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importedCount, setImportedCount] = useState(0);

  const targets = [
    { value: "", label: "Don't import this column" },
    ...(nameFormat === "full"
      ? [{ value: "full_name", label: "Full name" }]
      : [{ value: "first_name", label: "First name" }, { value: "last_name", label: "Last name" }]),
    ...(fields.some((f) => f.key === "group") ? [{ value: "group_leader", label: "Group leader (yes/no)" }] : []),
    ...fields.filter((f) => f.active).map((f) => ({ value: f.key, label: f.label })),
  ];

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setBusy(true);
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/events/${eventId}/invitees/upload`, { method: "POST", body: formData });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "We couldn't process that file.");
      return;
    }
    setHeaders(data.headers);
    setRecords(data.records);
    setFields(data.fields);
    setNameFormat(data.nameFormat);
    setColumnMap(data.columnMap);
    setAssemblies(data.assemblies || []);

    const everyHeaderMatched = data.headers.every((h: string) => data.columnMap[h]);
    if (everyHeaderMatched && data.invalidCount === 0) {
      // The file already lines up cleanly (e.g. our own template) — skip straight to the preview.
      setPreview({ total: data.total, validCount: data.validCount, invalidCount: data.invalidCount, duplicateCount: data.duplicateCount, valid: data.valid, invalid: data.invalid, duplicates: data.duplicates });
      setStep("preview");
    } else {
      setStep("map");
    }
  }

  function applyMapping() {
    const rows = validateRecords(records, columnMap, fields, nameFormat);
    setPreview(buildPreview(rows));
    setStep("preview");
  }

  async function confirmImport() {
    if (!preview) return;
    setBusy(true);
    const res = await fetch(`/api/events/${eventId}/invitees/upload/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: preview.valid, assemblyId: assemblyId || undefined }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Something went wrong during import.");
      return;
    }
    setImportedCount(data.created);
    setStep("done");
  }

  function downloadErrorReport() {
    if (!preview) return;
    const rows = [...preview.invalid, ...preview.duplicates];
    const lines = ["Row,First Name,Last Name,Email,Phone,Issue"];
    for (const r of rows) {
      const issue = r.isDuplicate ? "Duplicate record" : r.errors.join("; ");
      lines.push([r.rowNumber, r.firstName, r.lastName, r.email, r.phone, issue].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "upload-errors.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Modal title="Upload invitees" onClose={onClose} wide>
      {error && <div className="mb-4 rounded border border-clay-500/30 bg-clay-500/5 text-clay-600 text-sm px-3 py-2.5">{error}</div>}

      {step === "select" && (
        <div>
          <p className="text-sm text-ink-soft">
            Upload a CSV or XLSX file with your guest list — any column layout works, you'll get a
            chance to match your columns next. Not sure where to start?{" "}
            <a href={`/api/events/${eventId}/invitees/template`} download className="text-wine-500 hover:underline">Download a template</a> for
            the fields this event currently collects.
          </p>
          <label className="mt-5 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-paper-line rounded-lg py-12 cursor-pointer hover:border-wine-300 hover:bg-wine-50/30 transition-colors">
            <span className="text-sm text-ink-soft">{busy ? "Reading file…" : "Click to choose a .csv or .xlsx file"}</span>
            <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFileChange} disabled={busy} />
          </label>
        </div>
      )}

      {step === "map" && (
        <div>
          <p className="text-sm text-ink-soft">
            Match each column in your file to a field. We couldn't confidently match every column automatically —
            double-check the mapping below before continuing.
          </p>
          <div className="mt-4 max-h-80 overflow-auto border border-paper-line rounded">
            <table className="w-full min-w-[520px] text-xs">
              <thead className="bg-paper-soft sticky top-0">
                <tr className="text-left text-ink-faint">
                  <th className="px-3 py-2">Your column</th>
                  <th className="px-3 py-2">Sample</th>
                  <th className="px-3 py-2">Maps to</th>
                </tr>
              </thead>
              <tbody>
                {headers.map((h) => (
                  <tr key={h} className="border-t border-paper-line">
                    <td className="px-3 py-2 text-ink">{h}</td>
                    <td className="px-3 py-2 text-ink-faint">{String(records[0]?.[h] ?? "")}</td>
                    <td className="px-3 py-2">
                      <select
                        className="input py-1 text-xs"
                        value={columnMap[h] || ""}
                        onChange={(e) => setColumnMap((m) => ({ ...m, [h]: e.target.value }))}
                      >
                        {targets.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setStep("select")} className="btn-ghost">Choose a different file</button>
            <button onClick={applyMapping} className="btn-primary">Continue</button>
          </div>
        </div>
      )}

      {step === "preview" && preview && (
        <div>
          <p className="text-sm text-ink">
            <strong>{preview.total}</strong> records found — <span className="text-moss-600">{preview.validCount} valid</span>,{" "}
            <span className="text-clay-600">{preview.invalidCount} with errors</span>,{" "}
            <span className="text-brass-600">{preview.duplicateCount} duplicates</span>.
          </p>

          {assemblies.length > 0 && (
            <div className="mt-3">
              <label className="label">Import into assembly <span className="text-ink-faint font-normal">(optional)</span></label>
              <select className="input max-w-xs" value={assemblyId} onChange={(e) => setAssemblyId(e.target.value)}>
                <option value="">Unassigned</option>
                {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}

          {preview.invalidCount + preview.duplicateCount > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded border border-brass-200 bg-brass-50 px-4 py-2.5">
              <p className="text-sm text-brass-600">Some rows need attention and won't be imported.</p>
              <div className="flex items-center gap-3">
                <button onClick={() => setStep("map")} className="text-sm font-medium text-brass-600 hover:underline shrink-0">Fix column mapping</button>
                <button onClick={downloadErrorReport} className="text-sm font-medium text-brass-600 hover:underline shrink-0">Download error report</button>
              </div>
            </div>
          )}

          <div className="mt-4 max-h-64 overflow-auto border border-paper-line rounded">
            <table className="w-full min-w-[480px] text-xs">
              <thead className="bg-paper-soft sticky top-0">
                <tr className="text-left text-ink-faint">
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Group</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {[...preview.valid.map((r) => ({ ...r, ok: true })), ...preview.invalid.map((r) => ({ ...r, ok: false })), ...preview.duplicates.map((r) => ({ ...r, ok: false }))]
                  .sort((a, b) => a.rowNumber - b.rowNumber)
                  .map((r) => (
                    <tr key={r.rowNumber} className="border-t border-paper-line">
                      <td className="px-3 py-1.5 text-ink-faint">{r.rowNumber}</td>
                      <td className="px-3 py-1.5">{r.firstName} {r.lastName}</td>
                      <td className="px-3 py-1.5 text-ink-soft">{r.email || "—"}</td>
                      <td className="px-3 py-1.5 text-ink-soft">{r.groupName || "—"}</td>
                      <td className="px-3 py-1.5">
                        {r.ok ? (
                          <span className="text-moss-600">Ready</span>
                        ) : r.isDuplicate ? (
                          <span className="text-brass-600">Duplicate</span>
                        ) : (
                          <span className="text-clay-600">{r.errors.join(", ")}</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setStep("select")} className="btn-ghost">Choose a different file</button>
            <button onClick={confirmImport} disabled={busy || preview.validCount === 0} className="btn-primary">
              {busy ? "Importing…" : `Import ${preview.validCount} invitee${preview.validCount === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="text-center py-6">
          <p className="font-serif text-xl text-ink">{importedCount} invitees imported</p>
          <p className="mt-2 text-sm text-ink-soft">They're ready on your invitees list — send invitations any time from Messages.</p>
          <button onClick={onImported} className="btn-primary mt-6">Done</button>
        </div>
      )}
    </Modal>
  );
}
