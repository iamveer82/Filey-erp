import { ReactNode, useEffect, useRef, useState } from "react";
import { NavLink, Link, useNavigate } from "react-router-dom";
import { Bell, Search, ChevronDown, LogOut, X } from "lucide-react";
import Logo from "./Logo";
import { cn } from "../lib/format";
import { useModules } from "../lib/modules";
import { useAuth } from "../lib/auth";
import { useGlobalSearch, useNotifications } from "../lib/spotlight";

const GROUP_ORDER = [
  "Pages",
  "Products",
  "Orders",
  "Invoices",
  "Customers",
] as const;

const TONE_DOT: Record<string, string> = {
  warn: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

export default function Layout({ children }: { children: ReactNode }) {
  const nav = useNavigate();
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

  const [q, setQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hits = useGlobalSearch(q);
  const notifs = useNotifications();

  // ⌘K / Ctrl+K focuses search; Escape closes overlays.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setSearchOpen(true);
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
        setNotifOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click outside closes the relevant overlay.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (searchRef.current && !searchRef.current.contains(t))
        setSearchOpen(false);
      if (notifRef.current && !notifRef.current.contains(t))
        setNotifOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  const go = (to: string) => {
    nav(to);
    setSearchOpen(false);
    setNotifOpen(false);
    setQ("");
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-background p-3 gap-3">
      {/* ───────────── Sidebar ───────────── */}
      <aside className="w-64 shrink-0 bg-white rounded-2xl border border-brand-200 shadow-bento flex flex-col overflow-hidden">
        <div className="px-5 py-5 border-b border-brand-100">
          <Link
            to="/overview"
            className="flex items-center gap-2.5 cursor-pointer"
          >
            <Logo size={72} />
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
          {/* Global search */}
          <div ref={searchRef} className="relative flex-1 max-w-md">
            <Search
              size={16}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-400 z-10"
            />
            <input
              ref={inputRef}
              aria-label="Search"
              placeholder="Search products, orders, invoices, customers…"
              className="input pl-10 pr-14"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
            />
            {!q && (
              <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-brand-200 bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-400">
                ⌘K
              </kbd>
            )}
            {q && (
              <button
                aria-label="Clear search"
                onClick={() => {
                  setQ("");
                  inputRef.current?.focus();
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-brand-400 hover:text-ink hover:bg-brand-50 transition-colors"
              >
                <X size={14} />
              </button>
            )}

            {searchOpen && q.trim() && (
              <div className="absolute left-0 right-0 top-12 z-30 max-h-[60vh] overflow-y-auto rounded-2xl bg-white border border-brand-200 shadow-bento-hover p-2">
                {hits.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-brand-400">
                    No matches for “{q.trim()}”
                  </p>
                ) : (
                  GROUP_ORDER.map((g) => {
                    const items = hits.filter((h) => h.group === g);
                    if (items.length === 0) return null;
                    return (
                      <div key={g} className="mb-1 last:mb-0">
                        <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-brand-400">
                          {g}
                        </p>
                        {items.map((h, i) => (
                          <button
                            key={g + i}
                            onClick={() => go(h.to)}
                            className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left hover:bg-brand-50 transition-colors cursor-pointer"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold text-ink">
                                {h.label}
                              </span>
                              {h.sub && (
                                <span className="block truncate text-xs text-brand-400">
                                  {h.sub}
                                </span>
                              )}
                            </span>
                            <span className="shrink-0 text-[10px] font-semibold text-brand-300">
                              {g}
                            </span>
                          </button>
                        ))}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Notifications */}
            <div ref={notifRef} className="relative">
              <button
                aria-label="Notifications"
                onClick={() => setNotifOpen((o) => !o)}
                className="relative grid h-10 w-10 place-items-center rounded-xl bg-white border border-brand-200 text-brand-500 hover:bg-brand-50 hover:text-ink transition-colors cursor-pointer"
              >
                <Bell size={18} />
                {notifs.length > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-danger text-white text-[9px] font-bold grid place-items-center">
                    {notifs.length > 9 ? "9+" : notifs.length}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 top-12 z-30 w-80 max-h-[60vh] overflow-y-auto rounded-2xl bg-white border border-brand-200 shadow-bento-hover">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-brand-100">
                    <p className="text-sm font-bold text-ink">
                      Notifications
                    </p>
                    <span className="text-xs font-semibold text-brand-400">
                      {notifs.length}
                    </span>
                  </div>
                  {notifs.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-brand-400">
                      You’re all caught up.
                    </p>
                  ) : (
                    <div className="p-1.5">
                      {notifs.map((n) => (
                        <button
                          key={n.id}
                          onClick={() => go(n.to)}
                          className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-brand-50 transition-colors cursor-pointer"
                        >
                          <span
                            className={cn(
                              "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                              TONE_DOT[n.tone]
                            )}
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-ink">
                              {n.title}
                            </span>
                            <span className="block text-xs text-brand-400">
                              {n.detail}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

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
          <div className="pb-4 pr-1">{children}</div>
        </main>
      </div>
    </div>
  );
}
