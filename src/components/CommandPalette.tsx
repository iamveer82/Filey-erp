import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "./ui";
import { useNavigate } from "react-router-dom";
import {
  Search,
  CornerDownLeft,
  UserRound,
  Target,
  Contact,
} from "lucide-react";
import { useModules } from "../lib/modules";
import AppIcon from "../components/AppIcon";
import { crm, type CrmCustomer, type Lead, type Opportunity } from "../lib/api";

/* ⌘K / Ctrl-K command palette — jump to any page or CRM record. Data is
 * loaded lazily the first time it opens (and is already cached by the api
 * layer). Keyboard: ↑/↓ to move, Enter to go, Esc to close. */

interface Item {
  key: string;
  group: string;
  label: string;
  sub?: string;
  icon: React.ReactNode;
  badge?: string;
  run: () => void;
}

const QUICK_ACTIONS: {
  label: string;
  to: string;
  icon: React.ReactNode;
  keywords: string[];
}[] = [
  {
    label: "New invoice",
    to: "/invoicing?new=1",
    icon: <AppIcon name="invoicing" className="h-4 w-4" />,
    keywords: ["invoice", "bill"],
  },
  {
    label: "New quotation",
    to: "/quoting?new=1",
    icon: <AppIcon name="quotations" className="h-4 w-4" />,
    keywords: ["quotation", "quote"],
  },
  {
    label: "Add product",
    to: "/inventory?new=1",
    icon: <AppIcon name="inventory" className="h-4 w-4" />,
    keywords: ["product", "stock", "item"],
  },
  {
    label: "Add customer",
    to: "/customers?new=1",
    icon: <AppIcon name="customers" className="h-4 w-4" />,
    keywords: ["customer", "client", "crm"],
  },
  {
    label: "New sales order",
    to: "/orders?new=1",
    icon: <AppIcon name="orders" className="h-4 w-4" />,
    keywords: ["order", "sales"],
  },
  {
    label: "Record expense",
    to: "/purchase?new=1",
    icon: <AppIcon name="purchase" className="h-4 w-4" />,
    keywords: ["purchase", "expense", "spend"],
  },
];

export default function CommandPalette() {
  const nav = useNavigate();
  const { modules, isEnabled } = useModules();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [error, setError] = useState("");
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global toggle (dispatched from Layout's Ctrl+K handler).
  useEffect(() => {
    const h = () => setOpen((v) => !v);
    window.addEventListener("toggle-command-palette", h);
    return () => window.removeEventListener("toggle-command-palette", h);
  }, []);
  // Escape closes the palette.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // Refresh each time: records may have changed since the last search.
  useEffect(() => {
    if (!open) return;
    setQ("");
    setActive(0);
    setTimeout(() => inputRef.current?.focus(), 0);
    let cancelled = false;
    setError("");
    Promise.all([crm.customers(), crm.leads(), crm.opportunities()])
      .then(([c, l, o]) => {
        if (cancelled) return;
        setCustomers(c);
        setLeads(l);
        setOpps(o);

      })
      .catch(() => { if (!cancelled) { setCustomers([]); setLeads([]); setOpps([]); setError("Records could not be loaded. Close and reopen search to retry."); } });
    return () => { cancelled = true; };
  }, [open]);

  const go = (to: string) => {
    setOpen(false);
    nav(to);
  };

  const items = useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase();
    const match = (s: string) => s.toLowerCase().includes(term);
    const out: Item[] = [];

    // Always-visible quick actions first when search is empty or matches keywords
    const quickMatches = QUICK_ACTIONS.filter(
      (a) =>
        !term ||
        a.label.toLowerCase().includes(term) ||
        a.keywords.some((k) => k.includes(term))
    );
    if (quickMatches.length) {
      for (const a of quickMatches) {
        out.push({
          key: `qa-${a.label}`,
          group: "Quick actions",
          label: a.label,
          icon: a.icon,
          badge: "Create",
          run: () => go(a.to),
        });
      }
    }

    for (const m of modules) {
      if (!isEnabled(m.id)) continue;
      if (!term || match(m.label) || match(m.desc)) {
        out.push({
          key: `m-${m.id}`,
          group: "Pages",
          label: m.label,
          sub: m.desc,
          icon: <AppIcon name={m.icon} className="w-4 h-4" />,
          run: () => go(m.to),
        });
      }
    }
    if (term) {
      for (const c of customers) {
        if (match(c.name) || match(c.company ?? ""))
          out.push({
            key: `c-${c.id}`,
            group: "Customers",
            label: c.name,
            sub: c.company,
            icon: <UserRound size={15} />,
            run: () => go(`/customers/${c.id}`),
          });
      }
      for (const o of opps) {
        if (match(o.title) || match(o.customer_name))
          out.push({
            key: `o-${o.id}`,
            group: "Deals",
            label: o.title,
            sub: o.customer_name,
            icon: <Target size={15} />,
            run: () => go(`/crm?view=deals&q=${encodeURIComponent(o.title)}`),
          });
      }
      for (const l of leads) {
        const name =
          (l as { name?: string; company?: string }).name ??
          (l as { company?: string }).company ??
          "Lead";
        if (match(name))
          out.push({
            key: `l-${l.id}`,
            group: "Leads",
            label: name,
            icon: <Contact size={15} />,
            run: () => go("/crm"),
          });
      }
    }
    return out.slice(0, 40);
  }, [q, modules, customers, opps, leads, isEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (active >= items.length) setActive(0);
  }, [items.length, active]);


  // Group consecutive items for headings while keeping a flat index.
  let lastGroup = "";

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Search workspace">
        <div className="flex items-center gap-2 border-b border-brand-200 px-4">
          <Search size={16} className="text-brand-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                items[active]?.run();
              }
            }}
            aria-label="Search pages, customers, deals"
            placeholder="Search pages, customers, deals…"
            className="h-12 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-brand-400"
          />
          <kbd className="rounded border border-brand-200 px-1.5 py-0.5 text-[10px] text-brand-400">
            esc
          </kbd>
        </div>

        {error && <p role="alert" className="px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="max-h-[55vh] overflow-y-auto p-1.5">
          {!items.length ? (
            <p className="px-3 py-8 text-center text-sm text-brand-400">
              {q ? "No matches." : "Type to search, or pick a page below."}
            </p>
          ) : (
            items.map((it, i) => {
              const head = it.group !== lastGroup ? (lastGroup = it.group) : null;
              return (
                <div key={it.key}>
                  {head && (
                    <p className="px-3 pb-1 pt-2 text-[10px] font-medium text-brand-400">
                      {it.group}
                    </p>
                  )}
                  <button
                    onMouseEnter={() => setActive(i)}
                    onClick={() => it.run()}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left ${
                      i === active
                        ? "bg-primary-100 dark:bg-primary-400/15"
                        : "hover:bg-brand-50 dark:hover:bg-white/5"
                    }`}
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-500 dark:bg-white/8">
                      {it.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        {it.label}
                      </span>
                      {it.sub && (
                        <span className="block truncate text-xs text-brand-400">
                          {it.sub}
                        </span>
                      )}
                    </span>
                    {it.badge && (
                      <span className="rounded-full border border-brand-200 bg-surface px-2 py-0.5 text-[10px] font-medium text-brand-500">
                        {it.badge}
                      </span>
                    )}
                    {i === active && (
                      <CornerDownLeft size={14} className="text-brand-400" />
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
        <div className="flex items-center gap-4 border-t border-brand-200 px-4 py-2 text-[11px] text-brand-400">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-brand-200 px-1 py-0 text-[10px]">
              ↑↓
            </kbd>{" "}
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-brand-200 px-1 py-0 text-[10px]">
              ↵
            </kbd>{" "}
            open
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-brand-200 px-1 py-0 text-[10px]">
              esc
            </kbd>{" "}
            close
          </span>
        </div>
    </Modal>
  );
}
