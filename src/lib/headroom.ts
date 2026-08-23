/* Built-in context compression — a TypeScript take on the ideas behind
 * headroom-ai (Apache-2.0), sized for Filey's BYOK, client-side agent.
 *
 * Tool outputs are the bulk of an agent's token bill, and most of that bulk is
 * syntax and repetition: quoted keys repeated per row of a 40-row JSON array,
 * the same log line printed two hundred times. Compressing those before they
 * reach the model cuts cost without touching meaning — and because guessing
 * is how compression breaks agents, every crushed output stays REVERSIBLE:
 * the original is kept in a local store (CCR) and the model can call
 * headroom_retrieve(id) to see it verbatim.
 *
 * Deliberate limits: prose is never rewritten (a model-free rewriter mangles
 * exactly the nuance answers depend on), error payloads pass through whole
 * (models need exact error text), and money-relevant numbers are rendered
 * with String() so no float formatting ever rounds them.
 */

import { log } from "./log";

/** Below this many characters, compression overhead outweighs savings. */
const MIN_CHARS = 1500;
/** Hard backstop on anything placed on the wire (matches the old clip). */
const MAX_WIRE = 6000;
/** Largest original kept for retrieval; bigger inputs are clipped first. */
const MAX_STORED = 200_000;
const STORE_MAX_ENTRIES = 40;
const TTL_MS = 60 * 60 * 1000;

export const HEADROOM_RETRIEVE = "headroom_retrieve";

export interface WireText {
  text: string;
  /** Present when the full original was stored for headroom_retrieve. */
  ccrId?: string;
}

/* ── CCR: the reversible store ─────────────────────────────────────────────── */

let seq = 0;
const ccr = new Map<string, { text: string; at: number }>();

function rememberOriginal(text: string): string {
  if (text.length > MAX_STORED) text = `${text.slice(0, MAX_STORED)}…[clipped]`;
  const id = `hr${++seq}`;
  // Re-insertion order IS recency in a Map, so delete-then-set is the LRU touch.
  ccr.delete(id);
  ccr.set(id, { text, at: Date.now() });
  while (ccr.size > STORE_MAX_ENTRIES) {
    const oldest = ccr.keys().next().value as string | undefined;
    if (!oldest) break;
    ccr.delete(oldest);
  }
  return id;
}

export function headroomRetrieve(id: string): unknown {
  const hit = ccr.get(id);
  if (!hit)
    return {
      error: `No stored output "${id}" — it may have been evicted or belongs to another run. Re-run the tool.`,
    };
  if (Date.now() - hit.at > TTL_MS) {
    ccr.delete(id);
    return { error: `Stored output "${id}" expired. Re-run the tool.` };
  }
  return { id, chars: hit.text.length, content: hit.text };
}

/** Test seam only. */
export function headroomReset(): void {
  ccr.clear();
  seq = 0;
}

/* ── Crushers ──────────────────────────────────────────────────────────────── */

const CELL_CAP = 48;

function cell(v: unknown): string {
  let s: string;
  if (typeof v === "string") s = v;
  else if (v == null) s = "";
  else if (Array.isArray(v)) s = `[${v.length} items]`;
  else if (typeof v === "object") s = `{…}`;
  else s = String(v); // numbers keep their exact value
  return s.length > CELL_CAP ? `${s.slice(0, CELL_CAP)}…` : s.replace(/\s+/g, " ");
}

/** Array of similar objects → columnar digest: one header line, one row per
 *  record, keys written once instead of N times. This is where most of the
 *  savings on ERP data comes from. */
function crushRows(rows: Record<string, unknown>[]): string {
  const cols: string[] = [];
  for (const r of rows.slice(0, 20))
    for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  const shown = cols.slice(0, 12);

  const KEEP_HEAD = 60;
  const KEEP_TAIL = 20;
  const lines: string[] = [
    `[${rows.length} rows × ${shown.length} cols] ${shown.join(" | ")}`,
  ];
  const emit = (r: Record<string, unknown>) =>
    lines.push(shown.map((k) => cell(r[k])).join(" | "));
  if (rows.length > KEEP_HEAD + KEEP_TAIL) {
    for (const r of rows.slice(0, KEEP_HEAD)) emit(r);
    lines.push(`[…${rows.length - KEEP_HEAD - KEEP_TAIL} more rows]`);
    for (const r of rows.slice(-KEEP_TAIL)) emit(r);
  } else {
    for (const r of rows) emit(r);
  }
  return lines.join("\n");
}

/** Nested object → key-path summary with type/size/preview per leaf. */
function crushObject(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(obj).slice(0, 40)) {
    if (v == null || typeof v !== "object") lines.push(`${k}: ${cell(v)}`);
    else if (Array.isArray(v))
      lines.push(`${k}: [${v.length} items] e.g. ${cell(v[0])}`);
    else
      lines.push(
        `${k}: {${Object.keys(v).length} keys} e.g. ${Object.keys(v).slice(0, 4).join(", ")}`
      );
  }
  return lines.join("\n");
}

function crushJson(value: unknown): string {
  if (Array.isArray(value)) {
    const objs = value.filter(
      (x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)
    );
    if (objs.length === value.length && objs.length > 0) return crushRows(objs);
    const scalars = value.map((v) => cell(v)).join(", ");
    return `[${value.length} items] ${scalars}`;
  }
  if (value && typeof value === "object") return crushObject(value as Record<string, unknown>);
  return String(value);
}

/** Log-ish text: collapse consecutive duplicate lines, then keep head+tail. */
function crushLog(text: string): string {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const last = out[out.length - 1];
    if (last != null && last.replace(/\s*×\d+$/, "") === line) {
      const n = /×(\d+)$/.exec(last)?.[1];
      out[out.length - 1] = `${line} ×${Number(n ?? 1) + 1}`;
    } else out.push(line);
  }
  const KEEP_HEAD = 120;
  const KEEP_TAIL = 40;
  if (out.length > KEEP_HEAD + KEEP_TAIL) {
    return [
      ...out.slice(0, KEEP_HEAD),
      `[…${out.length - KEEP_HEAD - KEEP_TAIL} more lines]`,
      ...out.slice(-KEEP_TAIL),
    ].join("\n");
  }
  return out.join("\n");
}

/* ── Router ────────────────────────────────────────────────────────────────── */

function looksLikeLog(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 5) return false;
  const sample = lines.slice(0, 50);
  const hits = sample.filter((l) =>
    /\b(INFO|WARN|ERROR|DEBUG|TRACE|FATAL)\b|\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}|^\s+at\s.+\(/.test(l)
  ).length;
  return hits / sample.length >= 0.3;
}

export interface HeadroomStats {
  calls: number;
  compressed: number;
  rawChars: number;
  wireChars: number;
}

const STATS_KEY = "filey.headroom.stats";
// eslint-disable-next-line prefer-const -- bump() mutates its fields
let session: HeadroomStats = { calls: 0, compressed: 0, rawChars: 0, wireChars: 0 };

function bump(rawLen: number, wireLen: number, didCompress: boolean): void {
  session.calls++;
  session.rawChars += rawLen;
  session.wireChars += wireLen;
  if (didCompress) session.compressed++;
  try {
    const prev = JSON.parse(localStorage.getItem(STATS_KEY) || "null") as HeadroomStats | null;
    const next: HeadroomStats = {
      calls: (prev?.calls ?? 0) + 1,
      compressed: (prev?.compressed ?? 0) + (didCompress ? 1 : 0),
      rawChars: (prev?.rawChars ?? 0) + rawLen,
      wireChars: (prev?.wireChars ?? 0) + wireLen,
    };
    localStorage.setItem(STATS_KEY, JSON.stringify(next));
  } catch {
    /* storage off — session numbers still work */
  }
}

/** Lifetime numbers — bump() persists each call through, so the store already
 *  includes this session; the in-memory copy is only the fallback when
 *  localStorage is unavailable. */
export function headroomStats(): HeadroomStats {
  try {
    const prev = JSON.parse(localStorage.getItem(STATS_KEY) || "null") as HeadroomStats | null;
    if (prev) return prev;
  } catch {
    /* fall through */
  }
  return { ...session };
}

/** The one entry point the harness calls. Returns the exact string to place
 *  on the wire (already ≤ MAX_WIRE), plus the CCR id when an original was
 *  stored. Never throws — a compressor bug must not fail the tool call. */
export function compressForModel(name: string, raw: string): WireText {
  const passthrough = (): WireText => ({ text: raw.slice(0, MAX_WIRE) });
  try {
    if (raw.length < MIN_CHARS) {
      bump(raw.length, Math.min(raw.length, MAX_WIRE), false);
      return passthrough();
    }

    // Errors go whole: the model needs the exact message to recover, and they
    // are rarely large enough to hurt.
    let parsed: unknown;
    let isJson = false;
    const trimmed = raw.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        parsed = JSON.parse(trimmed);
        isJson =
          parsed != null &&
          typeof parsed === "object" &&
          !("error" in (parsed as Record<string, unknown>));
      } catch {
        isJson = false;
      }
    }

    const kind = isJson ? "json" : looksLikeLog(raw) ? "log" : "text";
    const body = kind === "json" ? crushJson(parsed) : kind === "log" ? crushLog(raw) : raw;

    const candidate = body.length < raw.length * 0.8 ? body : "";
    if (!candidate) {
      bump(raw.length, Math.min(raw.length, MAX_WIRE), false);
      return passthrough();
    }

    const id = rememberOriginal(raw);
    const footer = `\n\n[headroom] ${kind} compressed ${raw.length} → ${candidate.length} chars (~${Math.round((1 - candidate.length / raw.length) * 100)}% smaller). Full original: call headroom_retrieve("${id}").`;
    const text = `${candidate}${footer}`.slice(0, MAX_WIRE);
    log.info("headroom", name, { kind, from: raw.length, to: text.length });
    bump(raw.length, text.length, true);
    return { text, ccrId: id };
  } catch {
    return passthrough();
  }
}
