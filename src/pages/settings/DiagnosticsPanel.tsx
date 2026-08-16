import { useEffect, useMemo, useState } from "react";
import { Copy, Check, Trash2 } from "lucide-react";
import { clearLog, logAsText, logEntries, onLog, type LogEntry, type LogLevel } from "../../lib/log";
import { cn } from "../../lib/format";

/* What the app has been doing, for when it stops doing it.
 *
 * A desktop app has no console the owner can open, so "it just stopped
 * answering" was the most detailed bug report possible. This is the answer to
 * "what did it say?" — readable, and copyable in one click so it can be pasted
 * into a message. */

const TONE: Record<LogLevel, string> = {
  info: "text-muted-foreground",
  warn: "text-warning",
  error: "text-danger",
};

const time = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour12: false });

export default function DiagnosticsPanel() {
  const [entries, setEntries] = useState<LogEntry[]>(() => logEntries());
  const [scope, setScope] = useState("");
  const [level, setLevel] = useState<LogLevel | "">("");
  const [copied, setCopied] = useState(false);

  useEffect(() => onLog(() => setEntries(logEntries())), []);

  const scopes = useMemo(
    () => [...new Set(entries.map((e) => e.scope))].sort(),
    [entries]
  );
  const shown = useMemo(
    () =>
      entries
        .filter((e) => (!scope || e.scope === scope) && (!level || e.level === level))
        .slice()
        .reverse(), // newest first: the thing that just broke is at the top
    [entries, scope, level]
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[15px] font-semibold text-foreground">Diagnostics</h2>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          What the agent, WhatsApp and sync have been doing since the app
          started. Kept in memory only — it clears when you close Filey. If
          something misbehaves, copy this and send it over.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="input h-8 w-auto text-[12.5px]"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          aria-label="Filter by area"
        >
          <option value="">All areas</option>
          {scopes.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className="input h-8 w-auto text-[12.5px]"
          value={level}
          onChange={(e) => setLevel(e.target.value as LogLevel | "")}
          aria-label="Filter by level"
        >
          <option value="">Everything</option>
          <option value="warn">Warnings and errors</option>
          <option value="error">Errors only</option>
        </select>

        <div className="ml-auto flex items-center gap-2">
          <button
            className="btn-ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(logAsText()).then(
                () => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                },
                () => {
                  /* clipboard blocked — nothing useful to say */
                }
              );
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy all"}
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              clearLog();
              setEntries([]);
            }}
          >
            <Trash2 size={14} /> Clear
          </button>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-6 text-center text-[12.5px] text-muted-foreground">
          Nothing recorded yet. Use the agent or WhatsApp and it will show up here.
        </p>
      ) : (
        <div className="max-h-[60vh] overflow-auto rounded-xl border border-border bg-card">
          {shown.map((e, i) => (
            <div
              key={`${e.at}-${i}`}
              className="flex gap-3 border-b border-border px-3 py-2 text-[12px] last:border-b-0"
            >
              <span className="shrink-0 font-mono text-muted-foreground">{time(e.at)}</span>
              <span className="w-20 shrink-0 truncate font-medium text-muted-foreground">
                {e.scope}
              </span>
              <span className={cn("min-w-0 flex-1", TONE[e.level])}>
                {e.message}
                {e.detail && (
                  <span className="mt-0.5 block break-all font-mono text-[11px] text-muted-foreground">
                    {e.detail}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
