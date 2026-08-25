import { type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutGrid,
  FileText,
  PackageOpen,
  Users,
  Settings as SettingsIcon,
  Sparkles,
} from "lucide-react";
import { cn } from "@shared/format";

/* The phone's navigation: five bottom tabs, one floating action button that
 * follows the tab you're on, and the agent one thumb-tap away from anywhere
 * via the sparkle in the header of each screen's tab. */

const TABS = [
  { to: "/", label: "Home", icon: LayoutGrid },
  { to: "/invoices", label: "Invoices", icon: FileText },
  { to: "/inventory", label: "Stock", icon: PackageOpen },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

/** What the FAB creates, per tab. Tabs without a create action get none. */
const FAB: Record<string, { to: string; label: string }> = {
  "/": { to: "/invoices/new", label: "New invoice" },
  "/invoices": { to: "/invoices/new", label: "New invoice" },
  "/customers": { to: "/customers?new=1", label: "New customer" },
};

export function TabShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const fab = FAB[pathname];

  return (
    <div className="flex min-h-dvh flex-col bg-page">
      {/* Agent shortcut — the assistant is one tap from anywhere. */}
      <NavLink
        to="/agent"
        aria-label="Filey AI"
        className={cn(
          "fixed right-4 top-[calc(env(safe-area-inset-top,0px)+0.9rem)] z-40 grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-primary-600 shadow-sm transition-transform active:scale-90 dark:text-primary-400",
          pathname === "/agent" && "hidden"
        )}
      >
        <Sparkles size={18} />
      </NavLink>

      <main className="tab-safe flex-1 pb-24">{children}</main>

      {/* Floating create action */}
      {fab && (
        <NavLink
          to={fab.to}
          aria-label={fab.label}
          className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+5.2rem)] right-4 z-40 flex h-14 items-center gap-2 rounded-full bg-primary-500 px-5 text-[14px] font-semibold text-black shadow-lg transition-transform active:scale-95"
          style={{ background: "hsl(var(--primary-400))" }}
        >
          {fab.label}
        </NavLink>
      )}

      {/* Bottom tabs */}
      <nav className="tab-safe fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-xl">
          {TABS.map(({ to, label, icon: Icon }) => {
            const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
            return (
              <NavLink
                key={to}
                to={to}
                className={cn(
                  "flex flex-1 flex-col items-center gap-0.5 py-2.5 transition-colors",
                  active ? "text-foreground" : "text-muted-foreground"
                )}
              >
                <Icon size={21} strokeWidth={active ? 2.1 : 1.75} />
                <span className={cn("text-[10.5px]", active && "font-semibold")}>
                  {label}
                </span>
                <span
                  className={cn(
                    "h-0.5 w-6 rounded-full transition-colors",
                    active ? "bg-primary-500" : "bg-transparent"
                  )}
                  style={active ? { background: "hsl(var(--primary-500))" } : undefined}
                />
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
