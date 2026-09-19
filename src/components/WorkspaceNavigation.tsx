import { useEffect, useId, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronDown, Search, X } from "lucide-react";
import { prefetchModule, type AppModule } from "../modules/registry";
import { useLang } from "../lib/i18n";
import AppIcon from "./AppIcon";
import BloubBot from "./BloubBot";

const GROUPS = [
  { title: "Assistant", ids: ["agent"] },
  { title: "Business", ids: ["overview", "reports"] },
  { title: "Sales", ids: ["orders", "invoicing", "quoting", "crm", "customers", "follow-ups", "marketing"] },
  { title: "Purchases", ids: ["suppliers", "purchase", "purchase-orders", "purchase-invoices"] },
  { title: "Inventory", ids: ["inventory"] },
  { title: "Accounting", ids: ["people", "accounting", "bank-accounts", "cheques", "payment-receipts", "declaration"] },
  { title: "Service", ids: ["projects", "helpdesk"] },
  { title: "Team", ids: ["team", "comms"] },
  { title: "Tools", ids: ["tools", "files", "email-templates", "delivery-challans"] },
  { title: "System", ids: ["settings", "integrations"] },
];

/** Navigation only filters the modules already allowed by ModulesProvider. */
export default function WorkspaceNavigation({
  modules, isDesktop, mobileOpen, onNavigate,
}: {
  modules: Pick<AppModule, "id" | "to" | "label" | "icon" | "desc">[];
  isDesktop: boolean;
  mobileOpen: boolean;
  onNavigate: () => void;
}) {
  const { t } = useLang();
  const { pathname } = useLocation();
  const prefix = useId();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const filter = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setQuery("");
    setExpanded({});
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [pathname, mobileOpen]);

  const search = query.trim().toLocaleLowerCase();
  const groups = GROUPS.map(group => ({
    ...group,
    items: modules.filter(module => group.ids.includes(module.id)
      && (!search || `${t(module.label)} ${t(module.desc)} ${t(group.title)}`.toLocaleLowerCase().includes(search))),
  })).filter(group => group.items.length);

  return (
    <div className="workspace-navigation">
      <div className="workspace-nav-search">
        <Search size={18} strokeWidth={1.75} aria-hidden="true" />
        <input
          ref={filter}
          aria-label={t("Find a page")}
          placeholder={t("Find a page")}
          autoComplete="off"
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
        {query && <button type="button" aria-label={t("Clear page search")}
          onClick={() => { setQuery(""); filter.current?.focus(); }}>
          <X size={16} aria-hidden="true" />
        </button>}
      </div>
      <div ref={scroller} className="workspace-nav-scroll">
        {groups.map(group => {
          const current = group.items.some(module => pathname === module.to || pathname.startsWith(module.to + "/"));
          const direct = group.ids.length === 1;
          const open = direct || !!search || (expanded[group.title] ?? (isDesktop || current));
          const sectionId = `${prefix}-${group.title}`;
          return (
            <section key={group.title} className="workspace-nav-group">
              {!direct && <button
                type="button"
                className="workspace-nav-heading"
                aria-expanded={open}
                aria-controls={sectionId}
                disabled={!!search}
                onClick={() => setExpanded(previous => ({ ...previous, [group.title]: !open }))}
              >
                <span>{t(group.title)}</span>
                <ChevronDown size={14} aria-hidden="true" data-expanded={open} />
              </button>}
              <nav id={sectionId} aria-label={t(group.title)} hidden={!open}>
                {group.items.map(({ id, to, label, icon }) => (
                  <NavLink
                    key={id}
                    to={to}
                    onClick={onNavigate}
                    onPointerEnter={event => { if (event.pointerType === "mouse") prefetchModule(id); }}
                    onFocus={() => prefetchModule(id)}
                    className="workspace-nav-link"
                    data-assistant={id === "agent" || undefined}
                  >
                    <span className="workspace-nav-icon" aria-hidden="true">
                      {id === "agent"
                        ? <BloubBot size={48} state="idle" animate={isDesktop || mobileOpen} ambient trackCursor />
                        : <AppIcon name={icon} className="h-[18px] w-[18px]" />}
                    </span>
                    <span className="min-w-0 truncate">{t(label)}</span>
                  </NavLink>
                ))}
              </nav>
            </section>
          );
        })}
        {groups.length === 0 && <p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">
          {t("No pages found. Try another name.")}
        </p>}
      </div>
    </div>
  );
}
