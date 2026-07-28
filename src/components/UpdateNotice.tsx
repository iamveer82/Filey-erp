import { useEffect, useState } from "react";
import { X, Loader2, Sparkles } from "lucide-react";
import { checkForUpdate, installUpdate, type UpdateInfo } from "../lib/updater";

/* localStorage key holding the version the user last dismissed, so we don't
 * re-nag about the same release on every launch. A newer version clears it. */
const DISMISS_KEY = "filey.update.dismissed";

/* "New update available" popup. Polls the updater shortly after launch; when a
 * signed release is available it shows the version + notes and lets the user
 * install + relaunch, or defer. Renders nothing unless an update exists. Once
 * dismissed, it stays hidden for that version until a newer one ships. */
export default function UpdateNotice() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const look = () => {
      checkForUpdate()
        .then((u) => {
          if (!alive || !u) return;
          // Skip a version the user already dismissed; a newer one still shows.
          let last: string | null = null;
          try {
            last = localStorage.getItem(DISMISS_KEY);
          } catch {
            /* ignore */
          }
          if (last === u.version) return;
          setInfo(u);
        })
        // A failed check must not reject unhandled — no network, or the backend
        // briefly unreachable, simply means we look again later.
        .catch(() => {});
    };
    // Defer so it doesn't compete with first paint / auth.
    const t = setTimeout(look, 4000);
    // One check per launch stranded anyone whose first check failed or who
    // leaves the app open for days. Look again periodically.
    const i = setInterval(look, 6 * 60 * 60 * 1000);
    return () => {
      alive = false;
      clearTimeout(t);
      clearInterval(i);
    };
  }, []);

  const dismiss = () => {
    if (info) {
      try {
        localStorage.setItem(DISMISS_KEY, info.version);
      } catch {
        /* ignore */
      }
    }
    setDismissed(true);
  };

  if (!info || dismissed) return null;

  const runUpdate = async () => {
    setBusy(true);
    setErr(null);
    try {
      await installUpdate(info.handle, setPct); // relaunches on success
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-xl border border-brand-200 bg-white p-7 shadow-sm">
        {!busy && (
          <button
            onClick={dismiss}
            aria-label="Close"
            className="absolute right-4 top-4 text-brand-400 hover:text-ink"
          >
            <X size={18} />
          </button>
        )}

        <div className="flex flex-col items-center text-center">
          <span className="grid h-14 w-14 place-items-center rounded-xl bg-primary-100 dark:bg-primary-400/15">
            <img
              src="/filey-logo.svg"
              alt="Filey"
              className="h-9 w-9"
              onError={(e) => {
                (e.currentTarget.style.display = "none");
              }}
            />
          </span>
          <h2 className="mt-4 text-xl font-semibold text-ink">New update available</h2>
          <p className="mt-1 text-sm text-brand-500">
            Filey {info.version} is ready to install.
          </p>
        </div>

        {info.notes.trim() && (
          <div className="mt-5 max-h-64 overflow-auto rounded-xl border border-brand-200 p-4 text-left">
            <Notes notes={info.notes} />
          </div>
        )}

        {err && (
          <p className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-xs font-medium text-danger">
            {err}
          </p>
        )}

        <button
          onClick={runUpdate}
          disabled={busy}
          className="btn-primary mt-5 w-full"
        >
          {busy ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              {pct > 0 ? `Updating… ${pct}%` : "Starting…"}
            </>
          ) : (
            <>
              <Sparkles size={15} /> Update now
            </>
          )}
        </button>
        {!busy && (
          <button
            onClick={dismiss}
            className="mt-2 w-full py-1.5 text-center text-sm font-medium text-brand-500 hover:text-ink"
          >
            Maybe later
          </button>
        )}
      </div>
    </div>
  );
}

/* Lightweight release-notes renderer: ALL-CAPS short lines → section labels,
 * `-`/`*`/`•` lines → bullets, everything else → paragraphs. */
function Notes({ notes }: { notes: string }) {
  const lines = notes
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        const isBullet = /^[-*•]\s+/.test(line);
        const text = line.replace(/^[-*•]\s+/, "");
        const isHeader =
          !isBullet && text.length <= 40 && text === text.toUpperCase() && /[A-Z]/.test(text);
        if (isHeader)
          return (
            <p
              key={i}
              className="pt-2 text-[11px] font-semibold uppercase tracking-wider text-brand-400 first:pt-0"
            >
              {text}
            </p>
          );
        if (isBullet)
          return (
            <div key={i} className="flex gap-2 text-sm text-brand-700">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary-400" />
              <span>{text}</span>
            </div>
          );
        return (
          <p key={i} className="text-sm text-brand-700">
            {text}
          </p>
        );
      })}
    </div>
  );
}
