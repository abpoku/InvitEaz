import Papa from "papaparse";
import * as XLSX from "xlsx";

/** Reads a CSV/XLSX file buffer into raw records keyed by their original column headers —
 * no field matching or validation here, see invitee-field-matching.ts for that. Kept separate
 * because this file's Buffer/xlsx dependency is Node-only, while the matching logic needs to
 * run in the browser too (so the column-mapping UI can re-validate without a round trip). */
export function parseFileToRecords(buffer: Buffer, filename: string): { headers: string[]; records: Record<string, any>[]; parseError: string | null } {
  const isXlsx = /\.xlsx?$/i.test(filename);
  let records: Record<string, any>[] = [];

  try {
    if (isXlsx) {
      const wb = XLSX.read(buffer, { type: "buffer" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      records = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    } else {
      const text = buffer.toString("utf-8");
      const result = Papa.parse(text, { header: true, skipEmptyLines: true });
      records = result.data as Record<string, any>[];
    }
  } catch {
    return { headers: [], records: [], parseError: "We couldn't read that file. Make sure it's a valid CSV or XLSX export." };
  }

  if (records.length === 0) {
    return { headers: [], records: [], parseError: "No records found in that file." };
  }

  const headers = Object.keys(records[0]);
  return { headers, records, parseError: null };
}
