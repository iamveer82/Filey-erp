import {
  ReactNode,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { NavLink, Link, useNavigate, useLocation } from "react-router-dom";
import {
  Bell,
  Search,
  LogOut,
  UserRound,
  Settings,
  Command,
  Menu,
  PanelLeft,
  ChevronsUpDown,
  LifeBuoy,
  BookOpen,
  Languages,
} from "lucide-react";
import AppIcon from "./AppIcon";
import ErrorBoundary from "./ErrorBoundary";
import { PageContextProvider } from "../lib/pageContext";
import { cn, setDisplayCurrency } from "../lib/format";
import AnimatedThemeToggler from "./AnimatedThemeToggler";
import { useModules } from "../lib/modules";
import { useAuth } from "../lib/auth";
import { useLang, LANGS, type Lang } from "../lib/i18n";
import { billing, followups, notifs as notifsApi, type Notification } from "../lib/api";
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

const GROUP_ORDER = ["Pages", "Products", "Orders", "Invoices", "Customers"] as const;

/** Sidebar sections (Emergent reference grouping). Order within a group
 *  mirrors the user's workflow. */
const MODULE_GROUPS: { title: string; ids: string[] }[] = [
  { title: "Assistant", ids: ["agent"] },
  { title: "Business", ids: ["overview", "reports"] },
  { title: "Sales", ids: ["orders", "invoicing", "quoting", "crm", "customers", "follow-ups"] },
  { title: "Purchases", ids: ["suppliers", "purchase", "purchase-orders"] },
  { title: "Inventory", ids: ["inventory"] },
  { title: "Accounting", ids: ["people", "accounting", "bank-accounts", "cheques", "payment-receipts", "declaration"] },
  { title: "Tools", ids: ["tools", "files", "email-templates", "delivery-challans"] },
  { title: "System", ids: ["settings", "integrations"] },
];

/** Quick-action commands for the search dropdown. `?new=1` deep-links a
 *  page to auto-open its create form. */
const COMMANDS: { label: string; to: string; keywords: string }[] = [
  { label: "New invoice", to: "/invoicing?new=1", keywords: "create invoice bill" },
  { label: "New quotation", to: "/quoting?new=1", keywords: "create quote" },
  { label: "Add product", to: "/inventory?new=1", keywords: "create product stock item" },
  { label: "Add customer", to: "/crm?new=1", keywords: "create customer client crm" },
  { label: "Add supplier", to: "/suppliers?new=1", keywords: "create supplier vendor" },
  { label: "New sales order", to: "/orders?new=1", keywords: "create order" },
  {
    label: "Record expense",
    to: "/purchase?new=1",
    keywords: "create purchase expense spend",
  },
  { label: "Go to Reports", to: "/reports", keywords: "reports analytics" },
  { label: "Open Tools", to: "/tools", keywords: "pdf tools utilities" },
  { label: "Settings", to: "/settings", keywords: "settings company account" },
];

const TONE_DOT: Record<string, string> = {
  warn: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

/** Reference wordmark — F glyph + name. */
function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-foreground">
        <path d="M4 4h16v3H7v4h10v3H7v6H4V4z" fill="currentColor" />
      </svg>
      <span className="text-[15px] font-semibold text-foreground tracking-tight">Filey</span>
    </span>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { profile, signOut } = useAuth();
  const { modules, enabledModules } = useModules();
  const navModules = enabledModules();
  const name = profile?.name || "User";
  const { lang, setLang, t } = useLang();

  // Online/offline state for connectivity indicator
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  useEffect(() => {
    const go = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", go);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", go);
      window.removeEventListener("offline", off);
    };
  }, []);

  // Current-page context for the header title. Match the longest module path
  // that prefixes the route; detail routes fall back to their parent module.
  const pageMeta =
    modules
      .filter((m) => pathname === m.to || pathname.startsWith(m.to + "/"))
      .sort((a, b) => b.to.length - a.to.length)[0] ??
    (pathname.startsWith("/customers")
      ? modules.find((m) => m.id === "crm")
      : pathname.startsWith("/suppliers")
        ? modules.find((m) => m.id === "suppliers")
        : undefined);

  // Keep the org's display currency in sync for dashboards/aggregates.
  const syncCurrency = () => {
    billing
      .getCompany()
      .then((c) => setDisplayCurrency(c.currency))
      .catch((e) => console.error("Failed to sync display currency:", e));
  };
  useEffect(syncCurrency, []);
  useLiveSync(syncCurrency);
  const initials = name
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // Sidebar: fixed 248px (reference). Header button hides/shows on desktop;
  // mobile uses an off-canvas drawer.
  const [hidden, setHidden] = useState(
    () => localStorage.getItem("sidebar.hidden") === "1"
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width:1024px)").matches
  );
  useEffect(() => {
    const m = window.matchMedia("(min-width:1024px)");
    const h = () => setIsDesktop(m.matches);
    m.addEventListener("change", h);
    return () => m.removeEventListener("change", h);
  }, []);
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);
  useEffect(() => {
    localStorage.setItem("sidebar.hidden", hidden ? "1" : "0");
  }, [hidden]);

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
      (c) => c.label.toLowerCase().includes(s) || c.keywords.includes(s)
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
                title: `${r.actor} ${r.kind === "mention" ? "mentioned you" : ""}`.trim(),
                message: r.body,
                avatar: initialsOf(r.actor),
                to: r.link,
              });
          }
        }
      })
      .catch((e) => console.error("Failed to load inbox:", e));
  };
  useEffect(loadInbox, []);
  useLiveSync(loadInbox);

  // Surface due / overdue follow-ups as in-app reminders, once per day.
  useEffect(() => {
    const key = "reminders.lastShown";
    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem(key) === today) return;
    followups
      .due()
      .then((due) => {
        if (!due.length) return;
        localStorage.setItem(key, today);
        due.slice(0, 3).forEach((f) =>
          toast.notify({
            title: "Follow-up due",
            message: `${f.title}${f.customer_name ? ` — ${f.customer_name}` : ""}`,
            to: "/follow-ups",
          })
        );
        if (due.length > 3) toast.info(`+${due.length - 3} more follow-ups due.`);
      })
      .catch((e) => console.error("Failed to check follow-up reminders:", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const unread = inbox.filter((n) => !n.read).length;
  const badge = unread + alerts.length;

  // "/" focuses the in-app search; Ctrl+K opens the command palette; Escape closes overlays.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        !!el && (/^(input|textarea|select)$/i.test(el.tagName) || el.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
        setSearchOpen(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("toggle-command-palette"));
        return;
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
        setNotifOpen(false);
        setQ("");
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
      if (searchRef.current && !searchRef.current.contains(t)) setSearchOpen(false);
      if (notifRef.current && !notifRef.current.contains(t)) setNotifOpen(false);
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

  /** Avatar disc — image if set, else initials on a neutral gradient. */
  const Avatar = ({ size }: { size: number }) =>
    profile?.avatar ? (
      <img
        src={profile.avatar}
        alt={name}
        style={{ width: size, height: size }}
        className="rounded-full object-cover shrink-0"
      />
    ) : (
      <span
        style={{ width: size, height: size }}
        className="rounded-full bg-gradient-to-br from-neutral-500 to-neutral-800 text-white text-[11px] font-medium grid place-items-center shrink-0"
      >
        {initials}
      </span>
    );

  /** Shared account dropdown content (header avatar + sidebar footer). */
  const accountMenu = (
    <DropdownMenuContent align="end" className="min-w-52">
      <DropdownMenuLabel>{profile?.email || name}</DropdownMenuLabel>
      <DropdownMenuItem onSelect={() => nav("/settings?section=account")}>
        <UserRound size={14} /> {t("Account")}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => nav("/settings")}>
        <Settings size={14} /> {t("Settings")}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="flex items-center gap-1.5">
        <Languages size={12} /> {t("Language")}
      </DropdownMenuLabel>
      {(Object.keys(LANGS) as Lang[]).map((code) => (
        <DropdownMenuItem key={code} onSelect={() => setLang(code)}>
          <span className={`fi fi-${LANGS[code].flag} rounded-sm`} />
          <span className="flex-1">{LANGS[code].name}</span>
          {code === lang && <span className="text-xs text-muted-foreground">✓</span>}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={() => {
          signOut().catch(() => toast.error("Failed to sign out"));
        }}
        className="text-danger focus:text-danger focus:bg-danger/10"
      >
        <LogOut size={14} /> {t("Sign out")}
      </DropdownMenuItem>
    </DropdownMenuContent>
  );

  const showSidebar = isDesktop ? !hidden : true;

  return (
    <PageContextProvider>
      <div className="flex h-full w-full overflow-hidden bg-background">
        {/* Offline banner */}
        {!isOnline && (
          <div className="absolute top-0 left-0 right-0 z-50 bg-amber-500 text-black text-center text-xs font-semibold py-1.5">
            {t("You are offline — changes will sync when reconnected")}
          </div>
        )}
        {/* Mobile drawer backdrop */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/40 lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* ───────────── Sidebar (reference: 248px, grouped sections) ───────────── */}
        {showSidebar && (
          <aside
            className={cn(
              "w-[248px] shrink-0 h-full bg-sidebar border-r border-border flex flex-col",
              "max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-50 max-lg:h-screen max-lg:transition-transform max-lg:duration-200",
              mobileOpen ? "max-lg:translate-x-0" : "max-lg:-translate-x-full"
            )}
          >
            <div className="px-3 pt-3 pb-3">
              <Link
                to="/overview"
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-hover"
                title="Filey"
              >
                <Wordmark />
                <ChevronsUpDown className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
              </Link>
            </div>

            <div className="px-2 pb-3 overflow-y-auto overflow-x-hidden flex-1">
              {MODULE_GROUPS.map((group) => {
                const items = navModules.filter((m) => group.ids.includes(m.id));
                if (items.length === 0) return null;
                return (
                  <div key={group.title} className="mt-3 first:mt-0">
                    <div className="px-2.5 pb-1 text-[11.5px] font-medium text-muted-foreground">
                      {t(group.title)}
                    </div>
                    <nav className="flex flex-col gap-0.5">
                      {items.map(({ to, label, icon: iconName }) => (
                        <NavLink
                          key={to}
                          to={to}
                          className={({ isActive }) =>
                            cn(
                              "group flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13.5px] transition-colors",
                              isActive
                                ? "bg-hover text-foreground font-medium"
                                : "text-muted-foreground hover:bg-hover/60 hover:text-foreground"
                            )
                          }
                        >
                          {({ isActive }) => (
                            <>
                              <AppIcon
                                name={iconName}
                                className={cn(
                                  "h-[15px] w-[15px] shrink-0",
                                  isActive ? "text-foreground" : "text-muted-foreground"
                                )}
                              />
                              <span className="truncate">{t(label)}</span>
                            </>
                          )}
                        </NavLink>
                      ))}
                    </nav>
                  </div>
                );
              })}

              <div className="mt-6 border-t border-border pt-3 space-y-0.5">
                <a
                  href="#help"
                  className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] text-muted-foreground hover:bg-hover/60 hover:text-foreground"
                >
                  <LifeBuoy className="h-[15px] w-[15px]" />
                  {t("Help Center")}
                </a>
                <a
                  href="#docs"
                  className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] text-muted-foreground hover:bg-hover/60 hover:text-foreground"
                >
                  <BookOpen className="h-[15px] w-[15px]" />
                  {t("Documentation")}
                </a>
              </div>
            </div>

            <div className="border-t border-border p-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-hover">
                    <Avatar size={28} />
                    <span className="leading-tight text-left min-w-0">
                      <span className="block text-[13px] font-medium text-foreground truncate">
                        {name}
                      </span>
                      <span className="block text-[11px] text-muted-foreground truncate">
                        {profile?.email ?? profile?.company ?? "Admin"}
                      </span>
                    </span>
                    <ChevronsUpDown className="ml-auto h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  </button>
                </DropdownMenuTrigger>
                {accountMenu}
              </DropdownMenu>
            </div>
          </aside>
        )}

        {/* ───────────── Main column ───────────── */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <header className="shrink-0 z-30 h-14 bg-background/85 backdrop-blur border-b border-border flex items-center px-6 gap-4">
            {/* Sidebar toggle — desktop hides/shows, mobile opens the drawer */}
            <button
              onClick={() => (isDesktop ? setHidden((h) => !h) : setMobileOpen(true))}
              aria-label={t("Toggle sidebar")}
              className="h-8 w-8 grid place-items-center rounded-md hover:bg-hover text-foreground lg:inline-grid hidden"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setMobileOpen(true)}
              aria-label={t("Open menu")}
              className="h-8 w-8 grid place-items-center rounded-md hover:bg-hover text-foreground lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="h-4 w-px bg-border" />
            <span className="text-[14px] font-medium text-foreground truncate">
              {pageMeta ? t(pageMeta.label) : "Filey"}
            </span>

            <div className="ml-auto flex items-center gap-2">
              {/* Global search (reference: 260px, ⌘K hint) */}
              <div ref={searchRef} className="relative hidden md:flex items-center">
                <Search className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input
                  ref={inputRef}
                  aria-label="Search"
                  placeholder={t("Search…")}
                  className="pl-8 pr-16 py-1.5 text-[13px] w-[260px] rounded-md border border-border bg-card focus:border-muted-foreground outline-none text-foreground placeholder:text-muted-foreground"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setSearchOpen(true);
                  }}
                  onFocus={() => setSearchOpen(true)}
                />
                <div className="absolute right-2 flex items-center gap-0.5 text-[10px] text-muted-foreground pointer-events-none">
                  <Command className="h-3 w-3" />K
                </div>

                {searchOpen && (
                  <div
                    style={{ "--materialize-origin": "top" } as CSSProperties}
                    className="materialize-surface absolute left-0 right-0 top-11 z-30 overflow-hidden rounded-lg bg-card border border-border shadow-lg"
                  >
                    <div className="max-h-[52vh] overflow-y-auto p-1.5">
                      {/* Quick actions (command palette) */}
                      {cmdHits.length > 0 && (
                        <div className="mb-1">
                          <p className="px-2.5 pt-2 pb-1 text-[11.5px] font-medium text-muted-foreground">
                            {t("Actions")}
                          </p>
                          {cmdHits.map((c) => (
                            <button
                              key={c.to}
                              onClick={() => go(c.to)}
                              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left hover:bg-hover transition-colors cursor-pointer"
                            >
                              <span className="grid h-6 w-6 place-items-center rounded-md bg-muted text-foreground">
                                <Command size={12} />
                              </span>
                              <span className="text-[13px] text-foreground">{c.label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {q.trim() && hits.length === 0 && cmdHits.length === 0 ? (
                        <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">
                          No matches for “{q.trim()}”
                        </p>
                      ) : (
                        GROUP_ORDER.map((g) => {
                          const items = hits.filter((h) => h.group === g);
                          if (items.length === 0) return null;
                          return (
                            <div key={g} className="mb-1 last:mb-0">
                              <p className="px-2.5 pt-2 pb-1 text-[11.5px] font-medium text-muted-foreground">
                                {g}
                              </p>
                              {items.map((h, i) => (
                                <button
                                  key={g + i}
                                  onClick={() => go(h.to)}
                                  className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left hover:bg-hover transition-colors cursor-pointer"
                                >
                                  <span className="min-w-0">
                                    <span className="block truncate text-[13px] text-foreground">
                                      {h.label}
                                    </span>
                                    {h.sub && (
                                      <span className="block truncate text-[11.5px] text-muted-foreground">
                                        {h.sub}
                                      </span>
                                    )}
                                  </span>
                                  <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
                                    {g}
                                  </span>
                                </button>
                              ))}
                            </div>
                          );
                        })
                      )}
                    </div>
                    <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                      <span>
                        Press <b className="font-semibold">⌘K</b> for commands
                      </span>
                      <span>ESC to clear</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Light / dark theme toggle */}
              <AnimatedThemeToggler />

              {/* Notifications */}
              <div ref={notifRef} className="relative">
                <button
                  aria-label="Notifications"
                  onClick={() => setNotifOpen((o) => !o)}
                  className="h-8 w-8 grid place-items-center rounded-md hover:bg-hover text-foreground relative"
                >
                  <Bell className="h-4 w-4" />
                  {badge > 0 && (
                    <span className="absolute top-1 right-1 min-w-[14px] h-3.5 px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold grid place-items-center">
                      {badge > 9 ? "9+" : badge}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <div
                    style={{ "--materialize-origin": "top right" } as CSSProperties}
                    className="materialize-surface absolute right-0 top-11 z-30 w-80 max-h-[60vh] overflow-y-auto rounded-lg bg-card border border-border shadow-lg"
                  >
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                      <p className="text-[13px] font-semibold text-foreground">
                        {t("Notifications")}
                      </p>
                      {unread > 0 && (
                        <button
                          onClick={async () => {
                            await notifsApi.markAllRead();
                            loadInbox();
                          }}
                          className="text-[11.5px] font-medium text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                          {t("Mark all read")}
                        </button>
                      )}
                    </div>
                    {inbox.length === 0 && alerts.length === 0 ? (
                      <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">
                        {t("You’re all caught up.")}
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
                              "flex w-full items-start gap-3 rounded-md px-2.5 py-2 text-left transition-colors cursor-pointer",
                              n.read ? "hover:bg-hover" : "bg-hover/60 hover:bg-hover"
                            )}
                          >
                            <span
                              className={cn(
                                "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                                n.read ? "bg-border" : "bg-primary-400"
                              )}
                            />
                            <span className="min-w-0">
                              <span className="block text-[13px] font-medium text-foreground">
                                {n.actor} {n.kind === "mention" ? "mentioned you" : n.kind}
                              </span>
                              <span className="block text-[11.5px] text-muted-foreground truncate">
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
                            className="flex w-full items-start gap-3 rounded-md px-2.5 py-2 text-left hover:bg-hover transition-colors cursor-pointer"
                          >
                            <span
                              className={cn(
                                "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                                TONE_DOT[n.tone]
                              )}
                            />
                            <span className="min-w-0">
                              <span className="block text-[13px] font-medium text-foreground">
                                {n.title}
                              </span>
                              <span className="block text-[11.5px] text-muted-foreground">
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

              {/* Account */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button aria-label="Account menu" className="cursor-pointer">
                    <Avatar size={32} />
                  </button>
                </DropdownMenuTrigger>
                {accountMenu}
              </DropdownMenu>
            </div>
          </header>

          <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
            {/* Route container — pages are content-only; padding lives here
                (reference: px-6 pt-6 page gutter). */}
            <div key={pathname} className="fade-in px-4 sm:px-6 py-6">
              <ErrorBoundary>{children}</ErrorBoundary>
            </div>
          </main>
        </div>
      </div>
    </PageContextProvider>
  );
}
