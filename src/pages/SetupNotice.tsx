import { CloudOff } from "lucide-react";

export default function SetupNotice() {
  return (
    <div className="min-h-full grid place-items-center bg-brand-50 dark:bg-[#1C1C1E] p-6">
      <div className="w-full max-w-lg bento-card">
        <div className="flex items-center gap-3 mb-4">
          <div className="rounded-full bg-ink p-3 text-white">
            <CloudOff size={24} />
          </div>
          <div>
            <h1 className="text-xl font-medium text-ink">Connect Supabase</h1>
            <p className="text-sm text-brand-400">
              Cloud storage isn&apos;t configured yet
            </p>
          </div>
        </div>

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

        <p className="text-xs text-brand-400 mt-5">
          Your data is owned by your account — every table is row-level-secured to the
          signed-in user.
        </p>
      </div>
    </div>
  );
}
