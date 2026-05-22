import { ReactNode, useEffect, useRef, useState } from "react";
import { NavLink, Link, useNavigate } from "react-router-dom";
import {
  Bell,
  Search,
  ChevronDown,
  LogOut,
  X,
  UserRound,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Command,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import Logo from "./Logo";
import { cn, setDisplayCurrency } from "../lib/format";
import { getTheme, setTheme, type Theme } from "../lib/theme";
import { useModules } from "../lib/modules";
import { useAuth } from "../lib/auth";
import { billing, notifs as notifsApi, type Notification } from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { useGlobalSearch, useNotifications } from "../lib/spotlight";
import { useUI } from "../lib/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./DropdownMenu";

const GROUP_ORDER = [
  "Pages",
  "Products",
  "Orders",
  "Invoices",
  "Customers",
] as const;

/** Quick-action commands for the ⌘K palette. `create` deep-links a page
 *  to auto-open its create form via the ?new=1 query. */
const COMMANDS: { label: string; to: string; keywords: string }[] = [
  { label: "New invoice", to: "/invoicing?new=1", keywords: "create invoice bill" },
  { label: "New quotation", to: "/quoting?new=1", keywords: "create quote" },
  { label: "Add product", to: "/inventory?new=1", keywords: "create product stock item" },
  { label: "Add customer", to: "/crm?new=1", keywords: "create customer client crm" },
  { label: "Add supplier", to: "/suppliers?new=1", keywords: "create supplier vendor" },
  { label: "New sales order", to: "/orders?new=1", keywords: "create order" },
  { label: "Record expense", to: "/purchase?new=1", keywords: "create purchase expense spend" },
  { label: "Go to Reports", to: "/reports", keywords: "reports analytics" },
  { label: "Open Tools", to: "/tools", keywords: "pdf tools utilities" },
  { label: "Settings", to: "/settings", keywords: "settings company account" },
];

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

  // Keep the org's display currency in sync for dashboards/aggregates.
  const syncCurrency = () => {
    billing
      .getCompany()
      .then((c) => setDisplayCurrency(c.currency))
      .catch(() => {});
  };
  useEffect(syncCurrency, []);
  useLiveSync(syncCurrency);
  const initials = name
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("sidebar.collapsed") === "1"
  );
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("sidebar.collapsed", next ? "1" : "0");
      return next;
    });

  // Theme: cycle light → dark → system.
  const [theme, setThemeState] = useState<Theme>(() => getTheme());
  const cycleTheme = () => {
    const next: Theme =
      theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    setTheme(next);
    setThemeState(next);
  };
  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const themeLabel =
    theme === "light" ? "Light" : theme === "dark" ? "Dark" : "System";

  const [q, setQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { toast } = useUI();
  const hits = useGlobalSearch(q);
  const cmdHits = (() => {
    const s = q.trim().toLowerCase();
    if (!s) return COMMANDS;
    return COMMANDS.filter(
      (c) =>
        c.label.toLowerCase().includes(s) || c.keywords.includes(s)
    );
  })();
  const alerts = useNotifications();
  const [inbox, setInbox] = useState<Notification[]>([]);
  const seenRef = useRef<Set<number> | null>(null);

  const initialsOf = (s: string) =>
    s
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?";

  const loadInbox = () => {
    notifsApi
      .list()
      .then((rows) => {
        setInbox(rows);
        // First load seeds the seen-set silently; later loads (realtime)
        // pop a floating toast for any newly-arrived unread notification.
        if (seenRef.current === null) {
          seenRef.current = new Set(rows.map((r) => r.id));
          return;
        }
        const seen = seenRef.current;
        for (const r of rows) {
          if (!seen.has(r.id)) {
            seen.add(r.id);
            if (!r.read)
              toast.notify({
                title: `${r.actor} ${
                  r.kind === "mention" ? "mentioned you" : ""
                }`.trim(),
                message: r.body,
                avatar: initialsOf(r.actor),
                to: r.link,
              });
          }
        }
      })
      .catch(() => {});
  };
  useEffect(loadInbox, []);
  useLiveSync(loadInbox);
  const unread = inbox.filter((n) => !n.read).length;
  const badge = unread + alerts.length;

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
    <div className="flex h-full w-full overflow-hidden bg-background dark:bg-[#17150F] p-3 gap-3">
      {/* ───────────── Sidebar ───────────── */}
      <aside
        className={cn(
          "shrink-0 bg-white dark:bg-[#201D16] rounded-2xl border border-brand-200 dark:border-[#322E25] shadow-bento flex flex-col overflow-hidden transition-[width] duration-200 ease-out",
          collapsed ? "w-[76px]" : "w-64"
        )}
      >
        <div
          className={cn(
            "border-b border-brand-100 dark:border-[#2A261E] flex items-center",
            collapsed ? "px-2 py-4 justify-center" : "px-5 py-5"
          )}
        >
          <Link
            to="/overview"
            className="flex items-center gap-2.5 cursor-pointer min-w-0"
            title="Filey"
          >
            <Logo size={collapsed ? 40 : 72} />
            {!collapsed && (
              <span className="leading-tight">
                <span className="block font-bold text-ink text-lg">Filey</span>
                <span className="block text-[11px] font-semibold text-brand-400">
                  Business Suite
                </span>
              </span>
            )}
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 overflow-y-auto overflow-x-hidden">
          {!collapsed && (
            <p className="px-3 mb-2 text-[10px] font-bold uppercase tracking-widest text-brand-400">
              Menu
            </p>
          )}
          <div className="space-y-1">
            {navModules.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                title={collapsed ? label : undefined}
                className={({ isActive }) =>
                  cn(
                    "group relative flex items-center gap-3 rounded-xl py-2.5 text-sm font-semibold transition-colors duration-200 cursor-pointer",
                    collapsed ? "justify-center px-0" : "px-3",
                    isActive
                      ? "bg-primary-100 text-primary-700 dark:bg-primary-400/15 dark:text-primary-300"
                      : "text-brand-500 hover:bg-brand-50 hover:text-ink dark:text-[#A89F8C] dark:hover:bg-white/5 dark:hover:text-[#ECE7DD]"
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
                    {!collapsed && <span className="truncate">{label}</span>}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>

        <div className="px-3 py-3 border-t border-brand-100 dark:border-[#2A261E] space-y-1">
          <button
            onClick={cycleTheme}
            title={collapsed ? `Theme: ${themeLabel}` : undefined}
            aria-label={`Theme: ${themeLabel} (click to change)`}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl py-2.5 text-sm font-semibold text-brand-400 hover:bg-brand-50 hover:text-ink transition-colors cursor-pointer dark:hover:bg-white/5 dark:hover:text-[#ECE7DD]",
              collapsed ? "justify-center px-0" : "px-3"
            )}
          >
            <ThemeIcon size={18} className="shrink-0" />
            {!collapsed && (
              <span className="flex-1 text-left">Theme</span>
            )}
            {!collapsed && (
              <span className="text-xs text-brand-400">{themeLabel}</span>
            )}
          </button>
          <button
            onClick={signOut}
            title={collapsed ? "Sign out" : undefined}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl py-2.5 text-sm font-semibold text-brand-500 hover:bg-danger/10 hover:text-danger transition-colors cursor-pointer",
              collapsed ? "justify-center px-0" : "px-3"
            )}
          >
            <LogOut size={18} className="shrink-0" />
            {!collapsed && "Sign out"}
          </button>
          <button
            onClick={toggleCollapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl py-2.5 text-sm font-semibold text-brand-400 hover:bg-brand-50 hover:text-ink transition-colors cursor-pointer",
              collapsed ? "justify-center px-0" : "px-3"
            )}
          >
            {collapsed ? (
              <PanelLeftOpen size={18} className="shrink-0" />
            ) : (
              <PanelLeftClose size={18} className="shrink-0" />
            )}
            {!collapsed && "Collapse"}
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
              <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-brand-200 dark:border-[#322E25] bg-brand-50 dark:bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-brand-400">
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

            {searchOpen && (
              <div className="absolute left-0 right-0 top-12 z-30 max-h-[60vh] overflow-y-auto rounded-2xl bg-white dark:bg-[#201D16] border border-brand-200 dark:border-[#322E25] shadow-bento-hover p-2">
                {/* Quick actions (command palette) */}
                {cmdHits.length > 0 && (
                  <div className="mb-1">
                    <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-brand-400">
                      Actions
                    </p>
                    {cmdHits.map((c) => (
                      <button
                        key={c.to}
                        onClick={() => go(c.to)}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left hover:bg-brand-50 dark:hover:bg-white/5 transition-colors cursor-pointer"
                      >
                        <span className="grid h-6 w-6 place-items-center rounded-lg bg-primary-100 text-primary-700">
                          <Command size={13} />
                        </span>
                        <span className="text-sm font-semibold text-ink">
                          {c.label}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {q.trim() && hits.length === 0 && cmdHits.length === 0 ? (
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
                            className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left hover:bg-brand-50 dark:hover:bg-white/5 transition-colors cursor-pointer"
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
                className="relative grid h-10 w-10 place-items-center rounded-xl bg-white dark:bg-[#201D16] border border-brand-200 dark:border-[#322E25] text-brand-500 dark:text-[#A89F8C] hover:bg-brand-50 hover:text-ink dark:hover:bg-white/5 dark:hover:text-[#ECE7DD] transition-colors cursor-pointer"
              >
                <Bell size={18} />
                {badge > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-danger text-white text-[9px] font-bold grid place-items-center">
                    {badge > 9 ? "9+" : badge}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 top-12 z-30 w-80 max-h-[60vh] overflow-y-auto rounded-2xl bg-white dark:bg-[#201D16] border border-brand-200 dark:border-[#322E25] shadow-bento-hover">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-brand-100 dark:border-[#2A261E]">
                    <p className="text-sm font-bold text-ink">
                      Notifications
                    </p>
                    {unread > 0 && (
                      <button
                        onClick={async () => {
                          await notifsApi.markAllRead();
                          loadInbox();
                        }}
                        className="text-xs font-semibold text-primary-700 hover:underline cursor-pointer"
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                  {inbox.length === 0 && alerts.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-brand-400">
                      You’re all caught up.
                    </p>
                  ) : (
                    <div className="p-1.5">
                      {/* personal inbox (mentions etc.) */}
                      {inbox.map((n) => (
                        <button
                          key={`n${n.id}`}
                          onClick={async () => {
                            if (!n.read) {
                              await notifsApi.markRead(n.id);
                              loadInbox();
                            }
                            if (n.link) go(n.link);
                          }}
                          className={cn(
                            "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors cursor-pointer",
                            n.read ? "hover:bg-brand-50 dark:hover:bg-white/5" : "bg-primary-50/60 hover:bg-primary-100 dark:bg-primary-400/10 dark:hover:bg-primary-400/20"
                          )}
                        >
                          <span
                            className={cn(
                              "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                              n.read ? "bg-brand-200" : "bg-primary-500"
                            )}
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-ink">
                              {n.actor}{" "}
                              {n.kind === "mention"
                                ? "mentioned you"
                                : n.kind}
                            </span>
                            <span className="block text-xs text-brand-400 truncate">
                              {n.body}
                            </span>
                          </span>
                        </button>
                      ))}
                      {/* derived operational alerts */}
                      {alerts.map((n) => (
                        <button
                          key={n.id}
                          onClick={() => go(n.to)}
                          className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-brand-50 dark:hover:bg-white/5 transition-colors cursor-pointer"
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

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="Account menu"
                  className="flex items-center gap-2.5 h-10 rounded-xl bg-white dark:bg-[#201D16] border border-brand-200 dark:border-[#322E25] pl-1.5 pr-3 hover:bg-brand-50 dark:hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <span className="w-7 h-7 rounded-full bg-ink text-white grid place-items-center text-xs font-bold">
                    {initials}
                  </span>
                  <span className="hidden md:block leading-tight text-left">
                    <span className="block text-xs font-bold text-ink">
                      {name}
                    </span>
                    <span className="block text-[11px] text-brand-400">
                      {profile?.company ?? "Admin"}
                    </span>
                  </span>
                  <ChevronDown size={15} className="text-brand-400" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuLabel>{profile?.email || name}</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => nav("/tools")}>
                  <UserRound size={14} /> Account
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => nav("/settings")}>
                  <Settings size={14} /> Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem tone="danger" onSelect={signOut}>
                  <LogOut size={14} /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 min-w-0 overflow-auto rounded-2xl">
          <div className="pb-4 pr-1">{children}</div>
        </main>
      </div>
    </div>
  );
}
