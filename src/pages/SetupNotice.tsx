import type { CSSProperties } from "react";
import { HardDrive, Cloud, Check, ArrowRight } from "lucide-react";
import { setDataMode } from "../lib/dataMode";
import { cloudConfigured } from "../lib/supabase";
import Logo from "../components/Logo";

function choose(mode: "local" | "cloud") {
  setDataMode(mode);
  window.location.reload();
}

export default function SetupNotice() {
  const chooseLocal = () => choose("local");

  return (
    <div className="min-h-full grid place-items-center bg-canvas p-6">
      <div
        style={{ "--materialize-origin": "center" } as CSSProperties}
        className="materialize-surface w-full max-w-md"
      >
        {/* Identity - Geist Pixel wordmark on a clean Apple surface: the
            pixel display face is the one distinctive brand moment (design.md
            §3), everything around it stays quiet. */}
        <div className="flex flex-col items-center text-center mb-8">
          <Logo size={48} />
          <h1 className="mt-4 text-[32px] font-semibold tracking-tight leading-none text-foreground">Filey</h1>
          <p className="mt-3 text-sm text-brand-500">
            Your business data stays on this computer.
          </p>
        </div>

        {cloudConfigured && (
          <>
            <button
              onClick={() => void chooseLocal()}
              className="group w-full text-left rounded-xl border border-brand-200 dark:border-white/12
                         bg-white p-5 shadow-sm
                         transition-[box-shadow,border-color,transform] duration-200
                         hover:shadow-lg hover:border-brand-300 dark:hover:border-white/20
                         active:scale-[0.99] cursor-pointer
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2"
            >
              <div className="flex items-start gap-4">
                <div className="shrink-0 grid place-items-center h-11 w-11 rounded-xl bg-foreground text-background">
                  <HardDrive size={22} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-ink">Use on this device</h2>
                    <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[11px] font-semibold text-[#1c1917]">
                      14-day free trial
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-brand-500">
                    Create your free account online once, then try every app for 14 days on this device.
                  </p>
                  <ul className="mt-3 space-y-1.5">
                    {[
                      "Every app: invoicing, CRM, inventory, accounting, Word, Sheets, PDF and Slides",
                      "Works offline — your data stays on this computer",
                      "$1 of Filey AI to try the agent",
                      "Then Freedom: 1499 AED once, yours for life",
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

            {/* Cloud mode is being rebuilt: say so, and keep the one path that
                works today. */}
            <div className="w-full rounded-xl border border-dashed border-brand-200 dark:border-white/10 p-4">
              <div className="flex items-center gap-3">
                <div className="shrink-0 grid place-items-center h-9 w-9 rounded-xl bg-brand-100 dark:bg-white/10 text-ink">
                  <Cloud size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-ink">Filey Cloud</h2>
                    <span className="rounded-full bg-brand-100 dark:bg-white/10 px-2 py-0.5 text-[11px] font-medium text-brand-500">
                      Coming soon
                    </span>
                  </div>
                  <p className="text-[13px] text-brand-500">
                    Cloud mode is coming soon. Until then your records stay on this computer.
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
        {!cloudConfigured && (
          <>
            {/* No cloud in this build - offline is the only working path. */}
            <button
              onClick={() => void chooseLocal()}
              className="w-full text-left rounded-xl border border-brand-200 dark:border-white/10
                         bg-white p-4 shadow-sm transition-colors duration-200
                         hover:border-brand-300 dark:hover:border-white/20 active:scale-[0.99] cursor-pointer
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2"
            >
              <div className="flex items-center gap-3">
                <div className="shrink-0 grid place-items-center h-9 w-9 rounded-xl bg-foreground text-background">
                  <HardDrive size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold text-ink">Use offline</h2>
                  <p className="text-[13px] text-brand-500">
                    Try every app free for 14 days, then get Freedom to keep Filey for life. Sign in online once with your Filey account to link this device.
                  </p>
                </div>
                <ArrowRight size={16} className="shrink-0 text-brand-300" />
              </div>
            </button>
            <p className="mt-4 rounded-xl border border-dashed border-brand-200 dark:border-white/10 p-4 text-[13px] text-brand-500">
              Cloud mode is coming soon.
            </p>
          </>
        )}

        <p className="mt-6 text-center text-xs text-brand-400">
          You can move your data folder later in Settings.
        </p>
      </div>
    </div>
  );
}
