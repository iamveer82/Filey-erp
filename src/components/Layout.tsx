import { ReactNode } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import {
  Boxes,
  Bell,
  Search,
  ChevronDown,
  LogOut,
  HardDriveUpload,
  LayoutGrid,
  Home,
  ClipboardList,
  Calendar,
} from "lucide-react";
import { cn } from "../lib/format";
import { APPS } from "../lib/apps";
import { useAuth } from "../lib/auth";

const STORAGE_USED_PCT = 68;
const STORAGE_USED_GB = 68.3;
const STORAGE_TOTAL_GB = 100;

function StorageRing({ pct }: { pct: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <svg width="60" height="60" viewBox="0 0 60 60" className="-rotate-90">
      <circle
        cx="30"
        cy="30"
        r={r}
        fill="none"
        stroke="#F0E9D9"
        strokeWidth="7"
      />
      <circle
        cx="30"
        cy="30"
        r={r}
        fill="none"
        stroke="#FFD600"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c - (pct / 100) * c}
      />
    </svg>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const { profile, signOut } = useAuth();
  const name = profile?.name || "User";
  const initials = name
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const current = APPS.find((a) => a.to === loc.pathname)?.label ?? "Overview";

  return (
    <div className="flex h-full bg-background p-3 gap-3">
      {/* ───────────── Sidebar ───────────── */}
      <aside className="w-64 shrink-0 bg-white rounded-2xl border border-brand-200 shadow-bento flex flex-col overflow-hidden">
        <div className="px-5 py-5 flex items-center justify-between border-b border-brand-100">
          <Link to="/overview" className="flex items-center gap-2.5">
            <div className="rounded-xl bg-primary-400 p-1.5 text-ink">
              <Boxes size={20} />
            </div>
            <p className="font-bold text-ink text-lg">Filey</p>
          </Link>
          <div className="flex items-center gap-1">
            <button
              aria-label="Notifications"
              className="rounded-lg p-1.5 text-brand-500 hover:bg-brand-50 transition-colors cursor-pointer"
            >
              <Bell size={17} />
            </button>
            <div className="w-7 h-7 rounded-full bg-ink text-white grid place-items-center text-[10px] font-bold">
              {initials}
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {APPS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors duration-200 cursor-pointer",
                  isActive
                    ? "bg-primary-100 text-primary-700"
                    : "text-brand-500 hover:bg-brand-50 hover:text-ink"
                )
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3">
          <div className="rounded-2xl bg-brand-50 border border-brand-200 p-4">
            <div className="flex items-center gap-3">
              <div className="relative grid place-items-center">
                <StorageRing pct={STORAGE_USED_PCT} />
                <span className="absolute text-[13px] font-bold text-ink">
                  {STORAGE_USED_PCT}%
                </span>
              </div>
              <div>
                <p className="text-sm font-bold text-ink">Used</p>
                <p className="text-[11px] text-brand-400 mt-0.5">
                  {STORAGE_USED_GB} GB of {STORAGE_TOTAL_GB} GB
                </p>
              </div>
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-brand-200 overflow-hidden">
              <div
                className="h-full rounded-full bg-primary-400"
                style={{ width: `${STORAGE_USED_PCT}%` }}
              />
            </div>
            <button className="btn-ghost w-full justify-center mt-3 text-xs">
              <HardDriveUpload size={14} /> Upgrade Storage
            </button>
          </div>

          <div className="flex items-center justify-around mt-3 px-2 text-brand-400">
            {[LayoutGrid, Home, ClipboardList, Boxes, Calendar].map((I, i) => (
              <button
                key={i}
                aria-label="Quick access"
                className="rounded-lg p-2 hover:bg-brand-50 hover:text-ink transition-colors cursor-pointer"
              >
                <I size={17} />
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* ───────────── Main ───────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 shrink-0 flex items-center justify-between gap-4 mb-3">
          <div className="relative flex-1 max-w-md">
            <Search
              size={16}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-400"
            />
            <input
              placeholder="Search anything…"
              className="w-full rounded-xl border border-brand-200 bg-white pl-10 pr-14 py-2.5 text-sm text-ink placeholder:text-brand-400 focus:outline-none focus:ring-2 focus:ring-primary-300"
            />
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-brand-200 bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-400">
              ⌘K
            </kbd>
          </div>
          <div className="flex items-center gap-3">
            <button
              aria-label="Notifications"
              className="relative rounded-xl bg-white border border-brand-200 p-2.5 text-brand-500 hover:bg-brand-50 transition-colors cursor-pointer"
            >
              <Bell size={18} />
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary-400 text-ink text-[9px] font-bold grid place-items-center">
                3
              </span>
            </button>
            <div className="flex items-center gap-2.5 rounded-xl bg-white border border-brand-200 px-3 py-1.5">
              <div className="w-8 h-8 rounded-full bg-ink text-white grid place-items-center text-xs font-bold">
                {initials}
              </div>
              <div className="hidden md:block leading-tight">
                <p className="text-xs font-bold text-ink">{name}</p>
                <p className="text-[11px] text-brand-400">
                  {profile?.company ?? "Admin"}
                </p>
              </div>
              <button
                onClick={signOut}
                aria-label="Sign out"
                title="Sign out"
                className="rounded-lg p-1 text-brand-400 hover:text-danger hover:bg-brand-50 cursor-pointer transition-colors"
              >
                <LogOut size={15} />
              </button>
              <ChevronDown size={15} className="text-brand-400" />
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto rounded-2xl">
          <div className="pb-4">
            <p className="text-[11px] font-semibold text-brand-400 uppercase tracking-wide mb-1">
              Filey / {current}
            </p>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
