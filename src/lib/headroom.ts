/* Built-in context compression — a TypeScript take on the ideas behind
 * headroom-ai (Apache-2.0), sized for Filey's BYOK, client-side agent.
 *
 * Tool outputs are the bulk of an agent's token bill. Structured results stay
 * lossless while they fit; larger results use explicit, reversible pages.
 * Dropping fields or replacing nested lines with counts can remove financial
 * facts, so JSON is never reduced to a lossy object or table summary.
 * Repeated log lines may still be compressed. Every shortened output stays REVERSIBLE:
 * the original is kept in a local store (CCR) and the model can call
 * headroom_retrieve(id) to see it verbatim.
 *
 * Deliberate limits: prose, errors and financial values are never rewritten.
 * When output exceeds a page, the model sees an explicit continuation marker.
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

/** Keep older observations recoverable when the active context is shortened. */
export function retainToolOutput(text: string): WireText {
  const ccrId = rememberOriginal(text);
  return { ccrId, text: `${text.slice(0, 300)}\n[Earlier observation; full output: headroom_retrieve("${ccrId}").]` };
}

export function headroomRetrieve(id: string, offset = 0, limit = MAX_WIRE): unknown {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_WIRE)
    return { error: `Use a non-negative integer offset and a limit from 1 to ${MAX_WIRE}.` };
  const hit = ccr.get(id);
  if (!hit)
    return {
      error: `No stored output "${id}" — it may have been evicted or belongs to another run. Re-run the tool.`,
    };
  if (Date.now() - hit.at > TTL_MS) {
    ccr.delete(id);
    return { error: `Stored output "${id}" expired. Re-run the tool.` };
  }
  if (offset > hit.text.length) return { error: "Offset is beyond the stored output." };
  const end = Math.min(offset + limit, hit.text.length);
  return { id, chars: hit.text.length, offset, content: hit.text.slice(offset, end),
    next_offset: end < hit.text.length ? end : null };
}

/** Test seam only. */
export function headroomReset(): void {
  ccr.clear();
  seq = 0;
}

/* ── Repeated log lines ────────────────────────────────────────────────────── */

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
  try {
    // A JSON record's field order is not a relevance ranking. In particular,
    // invoice totals often follow dozens of optional header fields and lines.
    let isJson = false;
    const trimmed = raw.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try { JSON.parse(trimmed); isJson = true; } catch { /* plain text */ }
    }
    const isLog = !isJson && raw.length >= MIN_CHARS && looksLikeLog(raw);
    const crushed = isLog ? crushLog(raw) : raw;
    const body = crushed.length < raw.length * 0.8 ? crushed : raw;
    if (body === raw && raw.length <= MAX_WIRE) {
      bump(raw.length, raw.length, false);
      return { text: raw };
    }

    const id = rememberOriginal(raw);
    const footer = `[headroom] Output shortened. Do not infer missing values. Continue with headroom_retrieve("${id}", next_offset).${raw.length > MAX_STORED ? ` Stored output is capped at ${MAX_STORED} characters; use a narrower source query for later content.` : ""}`;
    let text: string;
    if (body !== raw && body.length + footer.length + 2 <= MAX_WIRE) {
      text = `${body}\n\n${footer.replace("next_offset", "0")}`;
    } else {
      // Keep valid JSON around the partial content, including its continuation
      // pointer. Account for escaping instead of slicing away the footer.
      let limit = MAX_WIRE;
      const page = () => JSON.stringify({ ...(headroomRetrieve(id, 0, limit) as object), note: footer });
      text = page();
      while (text.length > MAX_WIRE) {
        limit = Math.max(1, limit - (text.length - MAX_WIRE));
        text = page();
      }
    }
    log.info("headroom", name, { kind: isLog ? "log" : "page", from: raw.length, to: text.length });
    bump(raw.length, text.length, true);
    return { text, ccrId: id };
  } catch {
    // Even unexpected formatting failures must not masquerade as a complete
    // record with its tail silently missing.
    return { text: raw.length <= MAX_WIRE ? raw : "The tool output could not be displayed completely. Re-run a narrower read before quoting its values." };
  }
}
