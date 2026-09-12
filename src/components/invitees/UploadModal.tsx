"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";

interface Row {
  rowNumber: number; firstName: string; lastName: string; email: string; phone: string;
  groupName: string; groupLeader: boolean; isAdult: boolean; plusOneAllowed: string; notes: string;
  errors: string[]; isDuplicate?: boolean;
}

interface PreviewResult {
  total: number; validCount: number; invalidCount: number; duplicateCount: number;
  valid: Row[]; invalid: Row[]; duplicates: Row[];
}

export function UploadModal({ eventId, onClose, onImported }: { eventId: string; onClose: () => void; onImported: () => void }) {
  const [step, setStep] = useState<"select" | "preview" | "done">("select");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importedCount, setImportedCount] = useState(0);

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
    setPreview(data);
    setStep("preview");
  }

  async function confirmImport() {
    if (!preview) return;
    setBusy(true);
    const res = await fetch(`/api/events/${eventId}/invitees/upload/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: preview.valid }),
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
            Upload a CSV or XLSX file with your guest list. Not sure of the format?{" "}
            <a href="/inviteaz-invitee-template.csv" download className="text-wine-500 hover:underline">Download the template</a>.
          </p>
          <label className="mt-5 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-paper-line rounded-lg py-12 cursor-pointer hover:border-wine-300 hover:bg-wine-50/30 transition-colors">
            <span className="text-sm text-ink-soft">{busy ? "Reading file…" : "Click to choose a .csv or .xlsx file"}</span>
            <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFileChange} disabled={busy} />
          </label>
        </div>
      )}

      {step === "preview" && preview && (
        <div>
          <p className="text-sm text-ink">
            <strong>{preview.total}</strong> records found — <span className="text-moss-600">{preview.validCount} valid</span>,{" "}
            <span className="text-clay-600">{preview.invalidCount} with errors</span>,{" "}
            <span className="text-brass-600">{preview.duplicateCount} duplicates</span>.
          </p>

          {preview.invalidCount + preview.duplicateCount > 0 && (
            <div className="mt-3 flex items-center justify-between rounded border border-brass-200 bg-brass-50 px-4 py-2.5">
              <p className="text-sm text-brass-600">Some rows need attention and won't be imported.</p>
              <button onClick={downloadErrorReport} className="text-sm font-medium text-brass-600 hover:underline shrink-0">Download error report</button>
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
