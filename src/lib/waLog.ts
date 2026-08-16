// Rolling log of the WhatsApp conversation, so the in-app agent can read what
// was said on the phone. WhatsApp exposes no history API — this is only what
// the bridge saw while the app was running, newest last.
//
// ponytail: localStorage, capped. Move to SQLite if the owner ever wants the
// whole thread searchable rather than "what happened recently".

export interface WaLogEntry {
  /** epoch ms */
  at: number;
  /** in = from the person, out = what Filey answered */
  dir: "in" | "out";
  /** the other party's number (digits, no @s.whatsapp.net) */
  from: string;
  name?: string;
  text: string;
}

const KEY = "filey.wa_log";
const LIMIT = 200;

function read(): WaLogEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? (v as WaLogEntry[]) : [];
  } catch {
    return [];
  }
}

export function waLogAdd(e: Omit<WaLogEntry, "at"> & { at?: number }): void {
  try {
    const rows = read();
    rows.push({ ...e, at: e.at ?? Date.now() });
    if (rows.length > LIMIT) rows.splice(0, rows.length - LIMIT);
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    // A full or unavailable localStorage must never break answering a message.
  }
}

/** Newest last. `from` filters to one chat (digits are compared, so a JID or a
 *  formatted number both work). */
export function waLogList(opts: { from?: string; limit?: number } = {}): WaLogEntry[] {
  const digits = (s?: string) => (s ?? "").split("@")[0].split(":")[0].replace(/\D/g, "");
  const want = digits(opts.from);
  const rows = read().filter((r) => !want || digits(r.from) === want);
  const n = Math.max(1, Math.min(opts.limit ?? 30, LIMIT));
  return rows.slice(-n);
}

export function waLogClear(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
