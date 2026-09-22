"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/Modal";
import { InviteeFieldInput } from "@/components/invitees/InviteeFieldInput";
import { BulkEditModal } from "@/components/invitees/BulkEditModal";
import { groupCounts } from "@/lib/bulk-select";
import {
  validateRecords, revalidateIssues, findDuplicates, fieldIssueSummary,
  type MappedInviteeRow, type ExistingInviteeLite, type DuplicateMatch, type FieldIssueSummary,
} from "@/lib/invitee-field-matching";
import type { InviteeField, Assembly } from "@/components/invitees/InviteesManager";

type Step = "select" | "map" | "review" | "fix" | "duplicates" | "done";
type ResolutionStatus = "pending" | "create" | "merge" | "skip" | "merged-away";
interface RowResolution { rowNumber: number; action: ResolutionStatus; mergeIntoInviteeId?: string; }

const MERGE_FIELDS: { key: "firstName" | "lastName" | "email" | "phone"; label: string }[] = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
];

function applyFieldToRow(row: MappedInviteeRow, fields: InviteeField[], fieldKey: string, value: string): MappedInviteeRow {
  if (fieldKey === "first_name" || fieldKey === "full_name") return { ...row, firstName: value };
  if (fieldKey === "last_name") return { ...row, lastName: value };
  if (fieldKey === "group") return { ...row, groupName: value };
  if (fieldKey === "is_adult") return { ...row, isAdult: value !== "child" };
  if (fieldKey === "plus_one_policy") return { ...row, plusOneAllowed: value };
  const field = fields.find((f) => f.key === fieldKey);
  if (field?.kind === "core") {
    if (fieldKey === "email") return { ...row, email: value };
    if (fieldKey === "phone") return { ...row, phone: value };
    if (fieldKey === "notes") return { ...row, notes: value };
  }
  return { ...row, customFields: { ...row.customFields, [fieldKey]: value } };
}

function valueForField(row: MappedInviteeRow, f: InviteeField): string {
  if (f.key === "group") return row.groupName;
  if (f.key === "is_adult") return row.isAdult ? "adult" : "child";
  if (f.key === "plus_one_policy") return row.plusOneAllowed;
  if (f.kind === "core") {
    if (f.key === "email") return row.email;
    if (f.key === "phone") return row.phone;
    if (f.key === "notes") return row.notes;
    return "";
  }
  return row.customFields[f.key] || "";
}

export function UploadModal({ eventId, groupRsvpMode, onClose, onImported }: { eventId: string; groupRsvpMode: string; onClose: () => void; onImported: () => void }) {
  const [step, setStep] = useState<Step>("select");
  const [headers, setHeaders] = useState<string[]>([]);
  const [records, setRecords] = useState<Record<string, any>[]>([]);
  const [fields, setFields] = useState<InviteeField[]>([]);
  const [nameFormat, setNameFormat] = useState<"first_last" | "full">("first_last");
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [assemblies, setAssemblies] = useState<Assembly[]>([]);
  const [assemblyId, setAssemblyId] = useState("");
  const [existingInvitees, setExistingInvitees] = useState<ExistingInviteeLite[]>([]);
  const [rows, setRows] = useState<MappedInviteeRow[]>([]);
  const [resolutions, setResolutions] = useState<Record<number, RowResolution>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; merged: number; skipped: number } | null>(null);
  const [dismissedIssueBanner, setDismissedIssueBanner] = useState(false);

  const [fixSelected, setFixSelected] = useState<Set<number>>(new Set());
  const [showFixBulkEdit, setShowFixBulkEdit] = useState(false);
  const [editingRow, setEditingRow] = useState<number | null>(null);

  const [mergingRow, setMergingRow] = useState<number | null>(null);
  const [mergeChoices, setMergeChoices] = useState<Record<string, "uploaded" | "existing">>({});

  const targets = [
    { value: "", label: "Don't import this column" },
    ...(nameFormat === "full"
      ? [{ value: "full_name", label: "Full name" }]
      : [{ value: "first_name", label: "First name" }, { value: "last_name", label: "Last name" }]),
    ...(fields.some((f) => f.key === "group") ? [{ value: "group_leader", label: "Group leader (yes/no)" }] : []),
    ...fields.filter((f) => f.active).map((f) => ({ value: f.key, label: f.label })),
  ];

  const duplicateMap = useMemo(() => findDuplicates(rows, existingInvitees), [rows, existingInvitees]);
  const issueSummary = useMemo<FieldIssueSummary[]>(() => fieldIssueSummary(rows, fields, nameFormat), [rows, fields, nameFormat]);
  const pendingDuplicateCount = useMemo(
    () => rows.filter((r) => duplicateMap.has(r.rowNumber) && (resolutions[r.rowNumber]?.action ?? "pending") === "pending").length,
    [rows, duplicateMap, resolutions]
  );

  function seedResolutions(rs: MappedInviteeRow[], dupes: Map<number, DuplicateMatch>) {
    const next: Record<number, RowResolution> = {};
    for (const r of rs) next[r.rowNumber] = { rowNumber: r.rowNumber, action: dupes.has(r.rowNumber) ? "pending" : "create" };
    setResolutions(next);
  }

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
    setExistingInvitees(data.existingInvitees || []);
    setRows(data.rows);
    setDismissedIssueBanner(false);
    seedResolutions(data.rows, findDuplicates(data.rows, data.existingInvitees || []));

    const everyHeaderMatched = data.headers.every((h: string) => data.columnMap[h]);
    setStep(everyHeaderMatched ? "review" : "map");
  }

  function applyMapping() {
    const newRows = validateRecords(records, columnMap, fields, nameFormat);
    setRows(newRows);
    setDismissedIssueBanner(false);
    seedResolutions(newRows, findDuplicates(newRows, existingInvitees));
    setStep("review");
  }

  function updateRowField(rowNumber: number, fieldKey: string, value: string) {
    setRows((rs) => rs.map((r) => {
      if (r.rowNumber !== rowNumber) return r;
      const updated = applyFieldToRow(r, fields, fieldKey, value);
      return { ...updated, issues: revalidateIssues(updated, fields, nameFormat) };
    }));
  }

  function applyBulkFix(fieldKey: string, value: string) {
    setRows((rs) => rs.map((r) => {
      if (!fixSelected.has(r.rowNumber)) return r;
      const updated = applyFieldToRow(r, fields, fieldKey, value);
      return { ...updated, issues: revalidateIssues(updated, fields, nameFormat) };
    }));
    setFixSelected(new Set());
  }

  function setResolution(rowNumber: number, resolution: RowResolution) {
    setResolutions((rs) => ({ ...rs, [rowNumber]: resolution }));
  }

  function keepBoth(rowNumber: number) {
    setResolution(rowNumber, { rowNumber, action: "create" });
  }

  function skipRow(rowNumber: number) {
    setResolution(rowNumber, { rowNumber, action: "skip" });
  }

  function startMerge(rowNumber: number) {
    setMergingRow(rowNumber);
    setMergeChoices({});
  }

  function confirmMerge(row: MappedInviteeRow, match: DuplicateMatch) {
    let merged = { ...row };
    for (const f of MERGE_FIELDS) {
      if (mergeChoices[f.key] === "existing") {
        const existingValue = match.source === "db"
          ? existingInvitees.find((e) => e.id === match.existingInviteeId)?.[f.key] ?? ""
          : rows.find((r) => r.rowNumber === match.otherRowNumber)?.[f.key] ?? "";
        (merged as any)[f.key] = existingValue;
      }
    }
    merged.issues = revalidateIssues(merged, fields, nameFormat);
    setRows((rs) => rs.map((r) => (r.rowNumber === row.rowNumber ? merged : r)));

    if (match.source === "db") {
      setResolution(row.rowNumber, { rowNumber: row.rowNumber, action: "merge", mergeIntoInviteeId: match.existingInviteeId });
    } else {
      setResolution(row.rowNumber, { rowNumber: row.rowNumber, action: "create" });
      setResolution(match.otherRowNumber, { rowNumber: match.otherRowNumber, action: "merged-away" });
    }
    setMergingRow(null);
    setMergeChoices({});
  }

  function keepBothAllRemaining() {
    setResolutions((rs) => {
      const next = { ...rs };
      for (const r of rows) {
        if (duplicateMap.has(r.rowNumber) && next[r.rowNumber]?.action === "pending") next[r.rowNumber] = { rowNumber: r.rowNumber, action: "create" };
      }
      return next;
    });
  }

  function skipAllRemaining() {
    setResolutions((rs) => {
      const next = { ...rs };
      for (const r of rows) {
        if (duplicateMap.has(r.rowNumber) && next[r.rowNumber]?.action === "pending") next[r.rowNumber] = { rowNumber: r.rowNumber, action: "skip" };
      }
      return next;
    });
  }

  async function confirmImport() {
    setBusy(true);
    const confirmRows = rows
      .filter((r) => resolutions[r.rowNumber]?.action !== "merged-away")
      .map((r) => {
        const res = resolutions[r.rowNumber] ?? { rowNumber: r.rowNumber, action: "create" as const };
        return {
          rowNumber: r.rowNumber,
          action: (res.action === "pending" ? "create" : res.action) as "create" | "merge" | "skip",
          mergeIntoInviteeId: res.mergeIntoInviteeId,
          firstName: r.firstName, lastName: r.lastName, email: r.email, phone: r.phone,
          groupName: r.groupName, groupLeader: r.groupLeader, isAdult: r.isAdult,
          plusOneAllowed: r.plusOneAllowed, notes: r.notes, customFields: r.customFields,
        };
      });
    const res = await fetch(`/api/events/${eventId}/invitees/upload/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: confirmRows, assemblyId: assemblyId || undefined }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Something went wrong during import.");
      return;
    }
    setImportResult(data);
    setStep("done");
  }

  function statusFor(r: MappedInviteeRow): { label: string; className: string } {
    const action = resolutions[r.rowNumber]?.action;
    if (action === "merged-away") return { label: "Merged into another row", className: "text-ink-faint" };
    if (action === "skip") return { label: "Skipped", className: "text-ink-faint" };
    if (duplicateMap.has(r.rowNumber)) {
      if (action === "merge") return { label: "Duplicate — merging", className: "text-brass-600" };
      if (action === "pending") return { label: "Duplicate — needs a decision", className: "text-clay-600" };
      return { label: "Duplicate — keeping both", className: "text-brass-600" };
    }
    if (r.issues.length > 0) return { label: `${r.issues.length} issue${r.issues.length === 1 ? "" : "s"}`, className: "text-clay-600" };
    return { label: "Ready", className: "text-moss-600" };
  }

  function downloadErrorReport() {
    const flagged = rows.filter((r) => r.issues.length > 0 || duplicateMap.has(r.rowNumber));
    const lines = ["Row,First Name,Last Name,Email,Phone,Issue"];
    for (const r of flagged) {
      const parts = [...r.issues.map((i) => i.message)];
      const dup = duplicateMap.get(r.rowNumber);
      if (dup) parts.push(dup.source === "db" ? "Matches an existing invitee" : "Matches another row in this file");
      lines.push([r.rowNumber, r.firstName, r.lastName, r.email, r.phone, parts.join("; ")].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "upload-errors.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const flaggedRows = useMemo(() => rows.filter((r) => r.issues.length > 0), [rows]);
  const duplicateRows = useMemo(
    () => rows.filter((r) => duplicateMap.has(r.rowNumber) && resolutions[r.rowNumber]?.action !== "merged-away"),
    [rows, duplicateMap, resolutions]
  );
  const readyCount = rows.filter((r) => {
    const action = resolutions[r.rowNumber]?.action;
    return action !== "skip" && action !== "merged-away" && action !== "pending";
  }).length;

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

      {step === "review" && (
        <div>
          <p className="text-sm text-ink">
            <strong>{rows.length}</strong> records found — <span className="text-moss-600">{readyCount} ready</span>,{" "}
            <span className="text-clay-600">{flaggedRows.length} with issues</span>,{" "}
            <span className="text-brass-600">{duplicateRows.length} duplicates</span>.
          </p>

          {assemblies.length > 0 && (
            <div className="mt-3">
              <label className="label">Import into clone <span className="text-ink-faint font-normal">(optional)</span></label>
              <select className="input max-w-xs" value={assemblyId} onChange={(e) => setAssemblyId(e.target.value)}>
                <option value="">Unassigned</option>
                {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}

          {issueSummary.length > 0 && !dismissedIssueBanner && (
            <div className="mt-3 rounded border border-brass-200 bg-brass-50 px-4 py-2.5">
              <ul className="text-sm text-brass-600 space-y-0.5">
                {issueSummary.map((s) => (
                  <li key={`${s.field}:${s.type}`}>
                    {s.count} of {rows.length} rows {s.type === "missing" ? "missing" : "have an invalid"} {s.label}{s.type === "invalid_format" ? " format" : ""}
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex items-center gap-3">
                <button onClick={() => setStep("fix")} className="text-sm font-medium text-brass-600 hover:underline">Fix before upload</button>
                <button onClick={() => setDismissedIssueBanner(true)} className="text-sm font-medium text-brass-600 hover:underline">Continue anyway</button>
                <button onClick={downloadErrorReport} className="text-sm font-medium text-brass-600 hover:underline">Download error report</button>
              </div>
            </div>
          )}

          {duplicateRows.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded border border-clay-500/30 bg-clay-500/5 px-4 py-2.5">
              <p className="text-sm text-clay-600">{duplicateRows.length} rows match an existing invitee or another row in this file.</p>
              <button onClick={() => setStep("duplicates")} className="text-sm font-medium text-clay-600 hover:underline shrink-0">Review duplicates</button>
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
                {rows.map((r) => {
                  const status = statusFor(r);
                  return (
                    <tr key={r.rowNumber} className="border-t border-paper-line">
                      <td className="px-3 py-1.5 text-ink-faint">{r.rowNumber}</td>
                      <td className="px-3 py-1.5">{r.firstName} {r.lastName}</td>
                      <td className="px-3 py-1.5 text-ink-soft">{r.email || "—"}</td>
                      <td className="px-3 py-1.5 text-ink-soft">{r.groupName || "—"}</td>
                      <td className={`px-3 py-1.5 ${status.className}`}>{status.label}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setStep("select")} className="btn-ghost">Choose a different file</button>
            <button onClick={confirmImport} disabled={busy || pendingDuplicateCount > 0 || rows.length === 0} className="btn-primary">
              {busy ? "Importing…" : pendingDuplicateCount > 0 ? `Resolve ${pendingDuplicateCount} duplicates before importing` : `Import ${readyCount} invitee${readyCount === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}

      {step === "fix" && (
        <div>
          <p className="text-sm text-ink-soft">Fix the flagged rows below, or go back and import anyway — nothing here is required.</p>

          {flaggedRows.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="text-xs text-ink-faint flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={fixSelected.size === flaggedRows.length}
                  onChange={() => setFixSelected(fixSelected.size === flaggedRows.length ? new Set() : new Set(flaggedRows.map((r) => r.rowNumber)))}
                />
                Select all
              </label>
              {groupCounts(flaggedRows, (r) => r.groupName).length > 0 && (
                <select
                  className="input py-1 text-xs max-w-[200px]"
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    setFixSelected((prev) => new Set([...prev, ...flaggedRows.filter((r) => r.groupName === e.target.value).map((r) => r.rowNumber)]));
                  }}
                >
                  <option value="">Select all in group…</option>
                  {groupCounts(flaggedRows, (r) => r.groupName).map((g) => <option key={g.name} value={g.name}>{g.name} ({g.count})</option>)}
                </select>
              )}
              {fixSelected.size > 0 && (
                <>
                  <span className="text-xs text-ink-faint">{fixSelected.size} selected</span>
                  <button onClick={() => setShowFixBulkEdit(true)} className="text-xs font-medium text-wine-500 hover:underline">Bulk edit</button>
                  <button onClick={() => setFixSelected(new Set())} className="text-xs font-medium text-ink-faint hover:underline">Clear selection</button>
                </>
              )}
            </div>
          )}

          <div className="mt-3 max-h-96 overflow-auto border border-paper-line rounded divide-y divide-paper-line">
            {flaggedRows.map((r) => (
              <div key={r.rowNumber} className="p-3">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={fixSelected.has(r.rowNumber)}
                    onChange={() => setFixSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(r.rowNumber)) next.delete(r.rowNumber); else next.add(r.rowNumber);
                      return next;
                    })}
                  />
                  <div className="flex-1 text-xs">
                    <p className="text-ink">Row {r.rowNumber} — {r.firstName} {r.lastName}</p>
                    <p className="text-clay-600 mt-0.5">{r.issues.map((i) => i.message).join(", ")}</p>
                  </div>
                  <button onClick={() => setEditingRow(editingRow === r.rowNumber ? null : r.rowNumber)} className="text-xs font-medium text-wine-500 hover:underline shrink-0">
                    {editingRow === r.rowNumber ? "Close" : "Edit"}
                  </button>
                </div>

                {editingRow === r.rowNumber && (
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {nameFormat === "full" ? (
                      <div>
                        <label className="label">Full name</label>
                        <input className="input" value={r.firstName} onChange={(e) => updateRowField(r.rowNumber, "full_name", e.target.value)} />
                      </div>
                    ) : (
                      <>
                        <div>
                          <label className="label">First name</label>
                          <input className="input" value={r.firstName} onChange={(e) => updateRowField(r.rowNumber, "first_name", e.target.value)} />
                        </div>
                        <div>
                          <label className="label">Last name</label>
                          <input className="input" value={r.lastName} onChange={(e) => updateRowField(r.rowNumber, "last_name", e.target.value)} />
                        </div>
                      </>
                    )}
                    {fields.map((f) => (
                      <InviteeFieldInput
                        key={f.id}
                        field={f}
                        groupRsvpMode={groupRsvpMode}
                        value={valueForField(r, f)}
                        onChange={(v) => updateRowField(r.rowNumber, f.key, v)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-5 flex justify-end">
            <button onClick={() => setStep("review")} className="btn-primary">Done</button>
          </div>

          {showFixBulkEdit && (
            <BulkEditModal
              fields={fields}
              groupRsvpMode={groupRsvpMode}
              count={fixSelected.size}
              onApply={applyBulkFix}
              onClose={() => setShowFixBulkEdit(false)}
            />
          )}
        </div>
      )}

      {step === "duplicates" && (
        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-ink-soft">Decide what to do with each matching row.</p>
            {pendingDuplicateCount > 0 && (
              <div className="flex items-center gap-3 shrink-0">
                <button onClick={keepBothAllRemaining} className="text-xs font-medium text-wine-500 hover:underline">Keep both for all remaining</button>
                <button onClick={skipAllRemaining} className="text-xs font-medium text-wine-500 hover:underline">Skip all remaining</button>
              </div>
            )}
          </div>

          <div className="mt-3 max-h-96 overflow-auto border border-paper-line rounded divide-y divide-paper-line">
            {duplicateRows.map((r) => {
              const match = duplicateMap.get(r.rowNumber)!;
              const action = resolutions[r.rowNumber]?.action ?? "pending";
              const otherLabel = match.source === "db"
                ? (() => { const e = existingInvitees.find((x) => x.id === match.existingInviteeId); return e ? `${e.firstName} ${e.lastName} (already on your list)` : "an existing invitee"; })()
                : `row ${match.otherRowNumber} in this file`;
              const matchFieldLabel = match.matchField === "email" ? "email" : match.matchField === "phone" ? "phone" : "name";

              return (
                <div key={r.rowNumber} className="p-3">
                  <p className="text-xs text-ink">
                    Row {r.rowNumber} — {r.firstName} {r.lastName} matches {otherLabel} by {matchFieldLabel}.
                  </p>
                  <div className="mt-2 flex items-center gap-3">
                    <button onClick={() => keepBoth(r.rowNumber)} className={`text-xs font-medium hover:underline ${action === "create" ? "text-moss-600" : "text-ink-faint"}`}>Keep both</button>
                    <button onClick={() => startMerge(r.rowNumber)} className={`text-xs font-medium hover:underline ${action === "merge" ? "text-moss-600" : "text-ink-faint"}`}>Merge</button>
                    <button onClick={() => skipRow(r.rowNumber)} className={`text-xs font-medium hover:underline ${action === "skip" ? "text-moss-600" : "text-ink-faint"}`}>Skip</button>
                  </div>

                  {mergingRow === r.rowNumber && (
                    <div className="mt-3 rounded border border-paper-line bg-paper-soft p-3 space-y-2">
                      {MERGE_FIELDS.filter((f) => {
                        const otherValue = match.source === "db"
                          ? existingInvitees.find((e) => e.id === match.existingInviteeId)?.[f.key] ?? ""
                          : rows.find((x) => x.rowNumber === match.otherRowNumber)?.[f.key] ?? "";
                        return (r as any)[f.key] !== otherValue;
                      }).map((f) => {
                        const otherValue = match.source === "db"
                          ? existingInvitees.find((e) => e.id === match.existingInviteeId)?.[f.key] ?? ""
                          : rows.find((x) => x.rowNumber === match.otherRowNumber)?.[f.key] ?? "";
                        const choice = mergeChoices[f.key] ?? "uploaded";
                        return (
                          <div key={f.key} className="text-xs">
                            <p className="text-ink-faint mb-1">{f.label}</p>
                            <div className="flex items-center gap-4">
                              <label className="flex items-center gap-1.5">
                                <input type="radio" checked={choice === "uploaded"} onChange={() => setMergeChoices((c) => ({ ...c, [f.key]: "uploaded" }))} />
                                Uploaded: {(r as any)[f.key] || "—"}
                              </label>
                              <label className="flex items-center gap-1.5">
                                <input type="radio" checked={choice === "existing"} onChange={() => setMergeChoices((c) => ({ ...c, [f.key]: "existing" }))} />
                                Existing: {otherValue || "—"}
                              </label>
                            </div>
                          </div>
                        );
                      })}
                      <div className="flex justify-end gap-2 pt-1">
                        <button onClick={() => setMergingRow(null)} className="text-xs text-ink-faint hover:underline">Cancel</button>
                        <button onClick={() => confirmMerge(r, match)} className="text-xs font-medium text-wine-500 hover:underline">Confirm merge</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-5 flex justify-end">
            <button onClick={() => setStep("review")} disabled={pendingDuplicateCount > 0} className="btn-primary">
              {pendingDuplicateCount > 0 ? `${pendingDuplicateCount} left to resolve` : "Done"}
            </button>
          </div>
        </div>
      )}

      {step === "done" && importResult && (
        <div className="text-center py-6">
          <p className="font-serif text-xl text-ink">{importResult.created} created, {importResult.merged} merged, {importResult.skipped} skipped</p>
          <p className="mt-2 text-sm text-ink-soft">They're ready on your invitees list — send invitations any time from Messages.</p>
          <button onClick={onImported} className="btn-primary mt-6">Done</button>
        </div>
      )}
    </Modal>
  );
}
