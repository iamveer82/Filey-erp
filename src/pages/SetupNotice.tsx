import { useState, type CSSProperties } from "react";
import { HardDrive, Cloud, Check, ArrowRight } from "lucide-react";
import { setDataMode } from "../lib/dataMode";
import { cloudConfigured } from "../lib/supabase";
import Logo from "../components/Logo";

function choose(mode: "local" | "cloud") {
  setDataMode(mode);
  window.location.reload();
}

export default function SetupNotice() {
  // Cloud setup steps are hidden by default — an offline-first desktop user
  // should see one obvious path, not a wall of config (Apple: show the common
  // path first, advanced one level deeper).
  const [showCloudSetup, setShowCloudSetup] = useState(false);

  return (
    <div className="min-h-full grid place-items-center bg-canvas dark:bg-[#0F1011] p-6">
      <div
        style={{ "--materialize-origin": "center" } as CSSProperties}
        className="materialize-surface w-full max-w-md"
      >
        {/* Identity — Geist Pixel wordmark on a clean Apple surface: the
            pixel display face is the one distinctive brand moment (design.md
            §3), everything around it stays quiet. */}
        <div className="flex flex-col items-center text-center mb-8">
          <Logo size={48} />
          <h1 className="mt-4 font-pixel text-[32px] leading-none text-ink">Filey</h1>
          <p className="mt-3 text-sm text-brand-500">
            Choose how your business data is stored.
          </p>
        </div>

        {/* Primary path — offline. The recommended desktop default: fastest,
            no account, data never leaves the device. */}
        <button
          onClick={() => choose("local")}
          className="group w-full text-left rounded-3xl border border-brand-200 dark:border-white/12
                     bg-white dark:bg-[#1A1B1E] p-5 shadow-bento
                     transition-[box-shadow,border-color,transform] duration-200
                     hover:shadow-bento-hover hover:border-brand-300 dark:hover:border-white/20
                     active:scale-[0.99] cursor-pointer
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2"
        >
          <div className="flex items-start gap-4">
            <div className="shrink-0 grid place-items-center h-11 w-11 rounded-2xl bg-ink text-white">
              <HardDrive size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-ink">Use offline</h2>
                <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[11px] font-semibold text-ink">
                  Recommended
                </span>
              </div>
              <p className="mt-1 text-sm text-brand-500">
                Everything stays on this computer — no account, no internet.
              </p>
              <ul className="mt-3 space-y-1.5">
                {[
                  "Works fully offline",
                  "Nothing leaves this device",
                  "Switch to cloud sync anytime",
                ].map((line) => (
                  <li key={line} className="flex items-center gap-2 text-[13px] text-brand-600 dark:text-[#B6BAC1]">
                    <Check size={14} className="shrink-0 text-success" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
            <ArrowRight
              size={18}
              className="shrink-0 mt-1 text-brand-300 transition-colors duration-200 group-hover:text-ink"
            />
          </div>
        </button>

        {/* Divider */}
        <div className="my-5 flex items-center gap-3 text-[11px] font-medium uppercase tracking-wide text-brand-400">
          <span className="h-px flex-1 bg-brand-200 dark:bg-white/10" />
          or
          <span className="h-px flex-1 bg-brand-200 dark:bg-white/10" />
        </div>

        {/* Secondary path — cloud. Quiet by design. */}
        {cloudConfigured ? (
          <button
            onClick={() => choose("cloud")}
            className="w-full text-left rounded-2xl border border-brand-200 dark:border-white/10
                       bg-transparent p-4 transition-colors duration-200
                       hover:bg-brand-50 dark:hover:bg-white/5 active:scale-[0.99] cursor-pointer
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2"
          >
            <div className="flex items-center gap-3">
              <div className="shrink-0 grid place-items-center h-9 w-9 rounded-xl bg-brand-100 dark:bg-white/10 text-ink">
                <Cloud size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-ink">Use cloud sync</h2>
                <p className="text-[13px] text-brand-500">Sign in to sync across devices</p>
              </div>
              <ArrowRight size={16} className="shrink-0 text-brand-300" />
            </div>
          </button>
        ) : (
          <div className="rounded-2xl border border-brand-200 dark:border-white/10 p-4">
            <button
              onClick={() => setShowCloudSetup((v) => !v)}
              className="flex w-full items-center gap-3 text-left cursor-pointer"
            >
              <div className="shrink-0 grid place-items-center h-9 w-9 rounded-xl bg-brand-100 dark:bg-white/10 text-ink">
                <Cloud size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-ink">Connect Supabase</h2>
                <p className="text-[13px] text-brand-500">For online sync across devices</p>
              </div>
              <ArrowRight
                size={16}
                className={`shrink-0 text-brand-300 transition-transform duration-200 ${showCloudSetup ? "rotate-90" : ""}`}
              />
            </button>
            {showCloudSetup && (
              <ol className="mt-4 space-y-3 border-t border-brand-100 dark:border-white/8 pt-4 text-[13px] text-brand-500 list-decimal pl-5">
                <li>
                  Create a free project at{" "}
                  <span className="font-medium text-ink">supabase.com</span>.
                </li>
                <li>
                  In the dashboard open <span className="font-medium text-ink">SQL Editor</span> and
                  run{" "}
                  <code className="bg-brand-100 dark:bg-white/12 px-1.5 py-0.5 rounded text-xs">
                    supabase/schema.sql
                  </code>
                  .
                </li>
                <li>
                  Copy the <em>Project URL</em> and <em>anon public</em> key from{" "}
                  <span className="font-medium text-ink">Settings → API</span>.
                </li>
                <li>
                  Paste them into{" "}
                  <code className="bg-brand-100 dark:bg-white/12 px-1.5 py-0.5 rounded text-xs">
                    .env
                  </code>
                  :
                  <pre className="mt-2 bg-ink text-white text-xs rounded-2xl p-3 overflow-x-auto">
                    {`VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...`}
                  </pre>
                </li>
                <li>
                  Restart{" "}
                  <code className="bg-brand-100 dark:bg-white/12 px-1.5 py-0.5 rounded text-xs">
                    npm run tauri dev
                  </code>
                  .
                </li>
              </ol>
            )}
          </div>
        )}

        <p className="mt-6 text-center text-xs text-brand-400">
          You can change this later in Settings.
        </p>
      </div>
    </div>
  );
}
