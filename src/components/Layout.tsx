import { ReactNode } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import { Bell, Search, ChevronDown, LogOut } from "lucide-react";
import Logo from "./Logo";
import { cn } from "../lib/format";
import { useModules } from "../lib/modules";
import { MODULES } from "../modules/registry";
import { useAuth } from "../lib/auth";

export default function Layout({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const { profile, signOut } = useAuth();
  const { enabledModules } = useModules();
  const navModules = enabledModules();
  const name = profile?.name || "User";
  const initials = name
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const current =
    MODULES.find((m) => m.to === loc.pathname)?.label ?? "Overview";

  return (
    <div className="flex h-full w-full overflow-hidden bg-background p-3 gap-3">
      {/* ───────────── Sidebar ───────────── */}
      <aside className="w-64 shrink-0 bg-white rounded-2xl border border-brand-200 shadow-bento flex flex-col overflow-hidden">
        <div className="px-5 py-5 border-b border-brand-100">
          <Link
            to="/overview"
            className="flex items-center gap-2.5 cursor-pointer group"
          >
            <Logo
              size={72}
              className="transition-transform duration-200 group-hover:scale-105"
            />
            <span className="leading-tight">
              <span className="block font-bold text-ink text-lg">Filey</span>
              <span className="block text-[11px] font-semibold text-brand-400">
                Business Suite
              </span>
            </span>
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          <p className="px-3 mb-2 text-[10px] font-bold uppercase tracking-widest text-brand-400">
            Menu
          </p>
          <div className="space-y-1">
            {navModules.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors duration-200 cursor-pointer",
                    isActive
                      ? "bg-primary-100 text-primary-700"
                      : "text-brand-500 hover:bg-brand-50 hover:text-ink"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={cn(
                        "absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-primary-500 transition-opacity duration-200",
                        isActive ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <Icon size={18} className="shrink-0" />
                    {label}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>

        <div className="px-3 py-3 border-t border-brand-100">
          <button
            onClick={signOut}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-brand-500 hover:bg-danger/10 hover:text-danger transition-colors cursor-pointer"
          >
            <LogOut size={18} className="shrink-0" />
            Sign out
          </button>
        </div>
      </aside>

      {/* ───────────── Main ───────────── */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <header className="h-14 shrink-0 flex items-center justify-between gap-4 mb-3">
          <div className="relative flex-1 max-w-md">
            <Search
              size={16}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-400"
            />
            <input
              aria-label="Search"
              placeholder="Search anything…"
              className="input pl-10 pr-14"
            />
            <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-brand-200 bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-400">
              ⌘K
            </kbd>
          </div>
          <div className="flex items-center gap-3">
            <button
              aria-label="Notifications"
              className="relative grid h-10 w-10 place-items-center rounded-xl bg-white border border-brand-200 text-brand-500 hover:bg-brand-50 hover:text-ink transition-colors cursor-pointer"
            >
              <Bell size={18} />
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-primary-400 text-ink text-[9px] font-bold grid place-items-center">
                3
              </span>
            </button>
            <div className="flex items-center gap-2.5 h-10 rounded-xl bg-white border border-brand-200 pl-1.5 pr-3">
              <div className="w-7 h-7 rounded-full bg-ink text-white grid place-items-center text-xs font-bold">
                {initials}
              </div>
              <div className="hidden md:block leading-tight">
                <p className="text-xs font-bold text-ink">{name}</p>
                <p className="text-[11px] text-brand-400">
                  {profile?.company ?? "Admin"}
                </p>
              </div>
              <ChevronDown size={15} className="text-brand-400" />
            </div>
          </div>
        </header>

        <main className="flex-1 min-w-0 overflow-auto rounded-2xl">
          <div className="pb-4 pr-1">
            <p className="text-[11px] font-semibold text-brand-400 uppercase tracking-wide">
              Filey
            </p>
            <h1 className="text-2xl font-bold text-ink mb-4">{current}</h1>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
