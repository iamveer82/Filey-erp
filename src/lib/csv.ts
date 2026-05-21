// Tiny CSV toolkit — export any row set, parse an uploaded file.
// RFC-4180-ish: quotes fields containing comma/quote/newline, doubles
// embedded quotes.

function escapeCell(v: unknown): string {
  const s = v == null ? "" : String(v);
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

/** Trigger a client-side download of rows as a .csv file. */
export function downloadCsv(
  filename: string,
  rows: Record<string, unknown>[],
  columns?: { key: string; label?: string }[]
): void {
  const csv = toCsv(rows, columns);
  const blob = new Blob(["﻿" + csv], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
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
