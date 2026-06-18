import { CloudOff, HardDrive } from "lucide-react";
import { setDataMode } from "../lib/dataMode";
import { cloudConfigured } from "../lib/supabase";

function choose(mode: "local" | "cloud") {
  setDataMode(mode);
  window.location.reload();
}

export default function SetupNotice() {
  return (
    <div className="min-h-full grid place-items-center bg-brand-50 dark:bg-[#1C1C1E] p-6">
      <div className="w-full max-w-lg bento-card">
        {/* Offline-first: the fastest path. No account, no keys, data stays on
            this device. */}
        <div className="rounded-2xl border border-brand-200 dark:border-white/12 p-5 mb-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="rounded-full bg-ink p-3 text-white">
              <HardDrive size={24} />
            </div>
            <div>
              <h1 className="text-xl font-medium text-ink">Use offline</h1>
              <p className="text-sm text-brand-400">
                Store everything on this computer — no account, no internet
              </p>
            </div>
          </div>
          <p className="text-sm text-brand-500 mb-4">
            Invoices, quotes, customers and all data are saved locally and never
            leave this device. You can switch to cloud sync later.
          </p>
          <button
            onClick={() => choose("local")}
            className="w-full rounded-2xl bg-ink text-white py-3 font-medium hover:opacity-90 transition"
          >
            Start offline
          </button>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <div className="rounded-full bg-brand-200 dark:bg-white/12 p-3 text-ink">
            <CloudOff size={24} />
          </div>
          <div>
            <h1 className="text-xl font-medium text-ink">
              {cloudConfigured ? "Or use cloud sync" : "Or connect Supabase"}
            </h1>
            <p className="text-sm text-brand-400">
              For online sync across devices
            </p>
          </div>
        </div>

        {cloudConfigured && (
          <button
            onClick={() => choose("cloud")}
            className="w-full rounded-2xl border border-brand-300 dark:border-white/15 text-ink py-3 font-medium hover:bg-brand-100 dark:hover:bg-white/5 transition mb-2"
          >
            Use cloud account
          </button>
        )}

        {!cloudConfigured && (
        <ol className="text-sm text-brand-500 space-y-3 list-decimal pl-5">
          <li>
            Create a free project at{" "}
            <span className="font-medium text-ink">supabase.com</span>.
          </li>
          <li>
            In the Supabase dashboard open{" "}
            <span className="font-medium text-ink">SQL Editor</span> and run the contents
            of{" "}
            <code className="bg-brand-100 dark:bg-white/12 px-1.5 py-0.5 rounded text-xs">
              supabase/schema.sql
            </code>
            .
          </li>
          <li>
            Open <span className="font-medium text-ink">Project Settings → API</span> and
            copy the <em>Project URL</em> and <em>anon public</em> key.
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
            Stop and restart{" "}
            <code className="bg-brand-100 dark:bg-white/12 px-1.5 py-0.5 rounded text-xs">
              npm run tauri dev
            </code>
            .
          </li>
        </ol>
        )}

        <p className="text-xs text-brand-400 mt-5">
          Offline keeps everything on this computer. Cloud syncs across devices.
        </p>
      </div>
    </div>
  );
}
