// Tiny CSV toolkit — export any row set, parse an uploaded file.
// RFC-4180-ish: quotes fields containing comma/quote/newline, doubles
// embedded quotes.

import { hasTauri, saveBytes } from "./localPaths";

// Excel and Google Sheets EXECUTE a cell that opens with one of these, so an
// exported customer name of =HYPERLINK("http://…","Click") runs the moment the
// file is opened — and every field in these exports is text somebody typed
// into the app. Prefixing with an apostrophe makes the cell literal text.
const RISKY_LEAD = /^[=+\-@\t\r]/;
// …but this is an accounting export, and -500 must stay a number. A plain
// numeric cell is never a formula, so it is left exactly as it is.
const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?$/;

function escapeCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (RISKY_LEAD.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize rows to a CSV string. Columns default to the union of keys. */
export function toCsv(
  rows: Record<string, unknown>[],
  columns?: { key: string; label?: string }[]
): string {
  const cols: { key: string; label?: string }[] =
    columns ??
    Array.from(
      rows.reduce<Set<string>>((set, r) => {
        Object.keys(r).forEach((k) => set.add(k));
        return set;
      }, new Set())
    ).map((key) => ({ key }));
  const header = cols.map((c) => escapeCell(c.label ?? c.key)).join(",");
  const body = rows
    .map((r) => cols.map((c) => escapeCell(r[c.key])).join(","))
    .join("\n");
  return `${header}\n${body}`;
}

/** Trigger a client-side download of rows as a .csv file. On the desktop build
 *  this goes through the native save dialog — a blob `<a download>` click
 *  silently does nothing in the Tauri WebView2. */
export async function downloadCsv(
  filename: string,
  rows: Record<string, unknown>[],
  columns?: { key: string; label?: string }[]
): Promise<void> {
  const csv = toCsv(rows, columns);
  const name = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  const bytes = new TextEncoder().encode("﻿" + csv);
  if (hasTauri) {
    await saveBytes(name, bytes).catch((e) =>
      console.error("CSV export failed:", e)
    );
    return;
  }
  const blob = new Blob([bytes], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Parse CSV text into a matrix of string cells. */
export function parseCsvMatrix(text: string): string[][] {
  const s = text.replace(/\r\n?/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cur);
      cur = "";
    } else if (c === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += c;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** Parse CSV into row objects keyed by the header row. */
export function parseCsvObjects(text: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const matrix = parseCsvMatrix(text);
  if (!matrix.length) return { headers: [], rows: [] };
  const headers = matrix[0].map((h) => h.trim());
  const rows = matrix.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => (obj[h] = (r[i] ?? "").trim()));
    return obj;
  });
  return { headers, rows };
}
