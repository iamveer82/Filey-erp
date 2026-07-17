import { useState, type CSSProperties } from "react";
import { HardDrive, Cloud, Check, ArrowRight } from "lucide-react";
import { setDataMode } from "../lib/dataMode";
import { cloudConfigured } from "../lib/supabase";
import { canUseLocalMode, ENFORCE_LICENSING } from "../lib/license";
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
  const [licenseMsg, setLicenseMsg] = useState("");

  // Offline mode is the licensed tier — cloud is the free default.
  const chooseLocal = async () => {
    if (await canUseLocalMode()) {
      choose("local");
    } else {
      setLicenseMsg(
        "Offline mode needs a one-time Filey Desktop license. Start free in the cloud — you can buy the license later under Settings → Desktop License."
      );
    }
  };

  return (
    <div className="min-h-full grid place-items-center bg-canvas p-6">
      <div
        style={{ "--materialize-origin": "center" } as CSSProperties}
        className="materialize-surface w-full max-w-md"
      >
        {/* Identity — Geist Pixel wordmark on a clean Apple surface: the
            pixel display face is the one distinctive brand moment (design.md
            §3), everything around it stays quiet. */}
        <div className="flex flex-col items-center text-center mb-8">
          <Logo size={48} />
          <h1 className="mt-4 text-[32px] font-semibold tracking-tight leading-none text-foreground">Filey</h1>
          <p className="mt-3 text-sm text-brand-500">
            Choose how your business data is stored.
          </p>
        </div>

        {cloudConfigured && (
          <>
            {/* Primary path — cloud. The free default: account, sync, team. */}
            <button
              onClick={() => choose("cloud")}
              className="group w-full text-left rounded-xl border border-brand-200 dark:border-white/12
                         bg-white p-5 shadow-sm
                         transition-[box-shadow,border-color,transform] duration-200
                         hover:shadow-lg hover:border-brand-300 dark:hover:border-white/20
                         active:scale-[0.99] cursor-pointer
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2"
            >
              <div className="flex items-start gap-4">
                <div className="shrink-0 grid place-items-center h-11 w-11 rounded-xl bg-ink text-white">
                  <Cloud size={22} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-ink">Use Filey Cloud</h2>
                    <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[11px] font-semibold text-ink">
                      Free · Recommended
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-brand-500">
                    Sign up in the app — your data is stored securely and synced.
                  </p>
                  <ul className="mt-3 space-y-1.5">
                    {[
                      "Free account, ready in seconds",
                      "Synced and backed up across devices",
                      "Invite your team and share records",
                    ].map((line) => (
                      <li key={line} className="flex items-center gap-2 text-[13px] text-brand-600">
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

            {/* Secondary path — offline, the licensed tier. Quiet by design. */}
            <button
              onClick={() => void chooseLocal()}
              className="w-full text-left rounded-xl border border-brand-200 dark:border-white/10
                         bg-transparent p-4 transition-colors duration-200
                         hover:bg-brand-50 dark:hover:bg-white/5 active:scale-[0.99] cursor-pointer
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2"
            >
              <div className="flex items-center gap-3">
                <div className="shrink-0 grid place-items-center h-9 w-9 rounded-xl bg-brand-100 dark:bg-white/10 text-ink">
                  <HardDrive size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-ink">Use offline</h2>
                    {ENFORCE_LICENSING && (
                      <span className="rounded-full bg-brand-100 dark:bg-white/10 px-2 py-0.5 text-[11px] font-medium text-brand-500">
                        Desktop license
                      </span>
                    )}
                  </div>
                  <p className="text-[13px] text-brand-500">
                    Everything stays on this computer — no account, no internet.
                  </p>
                </div>
                <ArrowRight size={16} className="shrink-0 text-brand-300" />
              </div>
            </button>
            {licenseMsg && (
              <p className="mt-3 text-[13px] text-ink bg-primary-50 dark:bg-white/8 rounded-xl px-3 py-2">
                {licenseMsg}
              </p>
            )}
          </>
        )}
        {!cloudConfigured && (
          <>
            {/* No cloud in this build — offline is the only working path. */}
            <button
              onClick={() => void chooseLocal()}
              className="mb-4 w-full text-left rounded-xl border border-brand-200 dark:border-white/10
                         bg-white p-4 shadow-sm transition-colors duration-200
                         hover:border-brand-300 dark:hover:border-white/20 active:scale-[0.99] cursor-pointer
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2"
            >
              <div className="flex items-center gap-3">
                <div className="shrink-0 grid place-items-center h-9 w-9 rounded-xl bg-ink text-white">
                  <HardDrive size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold text-ink">Use offline</h2>
                  <p className="text-[13px] text-brand-500">
                    Everything stays on this computer — no account, no internet.
                  </p>
                </div>
                <ArrowRight size={16} className="shrink-0 text-brand-300" />
              </div>
            </button>
            {licenseMsg && (
              <p className="mb-4 text-[13px] text-ink bg-primary-50 dark:bg-white/8 rounded-xl px-3 py-2">
                {licenseMsg}
              </p>
            )}
          <div className="rounded-xl border border-brand-200 dark:border-white/10 p-4">
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
                  <pre className="mt-2 bg-ink text-white text-xs rounded-xl p-3 overflow-x-auto">
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
          </>
        )}

        <p className="mt-6 text-center text-xs text-brand-400">
          You can change this later in Settings.
        </p>
      </div>
    </div>
  );
}
