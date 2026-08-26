// What the app was doing when it went wrong, kept where the owner can read it.
//
// This exists because of a specific evening: the WhatsApp bridge received a
// message, answered nobody, and left no trace anywhere — not in the app, not on
// the phone, not in a file. Diagnosing it meant attaching to a dev build and
// re-running the failure. A desktop app with no console is not debuggable by
// the person using it, and "it just stopped working" is all they can report.
//
// Deliberately not a logging service and not persisted to disk: the target is
// "the owner can tell you what it said", not telemetry. A ring buffer in memory
// clears on restart, which is the right lifetime for something you look at when
// something has just gone wrong.
//
// ponytail: 400 entries, no rotation to disk, no levels beyond three. If a bug
// ever needs yesterday's log, that is the day to add a file.

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  at: number;
  level: LogLevel;
  /** Where it came from: "agent", "whatsapp", "sync"… */
  scope: string;
  message: string;
  /** Anything worth seeing alongside — kept small, and never a secret. */
  detail?: string;
}

const LIMIT = 400;
const entries: LogEntry[] = [];
const listeners = new Set<(e: LogEntry) => void>();

function push(level: LogLevel, scope: string, message: string, detail?: unknown) {
  const entry: LogEntry = {
    at: Date.now(),
    level,
    scope,
    message,
    ...(detail === undefined ? {} : { detail: stringify(detail) }),
  };
  entries.push(entry);
  if (entries.length > LIMIT) entries.splice(0, entries.length - LIMIT);
  for (const l of listeners) {
    try {
      l(entry);
    } catch {
      // A broken viewer must never break the thing it is watching.
    }
  }
  // Still goes to the console: the dev build's output is where this all
  // started, and losing it would trade one blind spot for another.
  const line = `[${scope}] ${message}`;
  if (level === "error") console.error(line, detail ?? "");
  else if (level === "warn") console.warn(line, detail ?? "");
  else console.info(line, detail ?? "");
}

function stringify(v: unknown): string {
  if (typeof v === "string") return v.slice(0, 500);
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  try {
    return JSON.stringify(v).slice(0, 500);
  } catch {
    return String(v).slice(0, 500);
  }
}

export const log = {
  info: (scope: string, message: string, detail?: unknown) =>
    push("info", scope, message, detail),
  warn: (scope: string, message: string, detail?: unknown) =>
    push("warn", scope, message, detail),
  error: (scope: string, message: string, detail?: unknown) =>
    push("error", scope, message, detail),
};

/** Newest last. */
export function logEntries(opts: { scope?: string; level?: LogLevel } = {}): LogEntry[] {
  return entries.filter(
    (e) => (!opts.scope || e.scope === opts.scope) && (!opts.level || e.level === opts.level)
  );
}

export function clearLog(): void {
  entries.length = 0;
}

/** Live updates for the viewer. Returns an unsubscribe. */
export function onLog(cb: (e: LogEntry) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Log entries as text, for pasting into a bug report. Pass a filtered array
 *  to serialise only the visible subset; omit for the whole buffer. */
export function logAsText(filter?: LogEntry[]): string {
  const rows = filter ?? entries;
  return rows
    .map(
      (e) =>
        `${new Date(e.at).toISOString()} ${e.level.toUpperCase().padEnd(5)} [${e.scope}] ${
          e.message
        }${e.detail ? ` — ${e.detail}` : ""}`
    )
    .join("\n");
}
