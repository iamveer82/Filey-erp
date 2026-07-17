import { useMemo } from "react";
import { useModules } from "../../lib/modules";
import { useUI } from "../../lib/ui";
import { cn } from "../../lib/format";
import AppIcon from "../../components/AppIcon";

/* ---------------- Apps & Modules ----------------
   Reference Settings grouped on/off grid. State lives in lib/modules.tsx
   (persisted workspace setting); core modules are always on. */

const GROUP_ORDER = [
  "Assistant",
  "Business",
  "Sales",
  "Purchases",
  "Inventory",
  "Accounting",
  "Tools",
];

/** Presentation grouping only — the registry itself stays flat. */
const GROUP_BY_ID: Record<string, string> = {
  agent: "Assistant",
  overview: "Business",
  reports: "Business",
  settings: "Business",
  orders: "Sales",
  invoicing: "Sales",
  quoting: "Sales",
  crm: "Sales",
  customers: "Sales",
  "follow-ups": "Sales",
  suppliers: "Purchases",
  purchase: "Purchases",
  "purchase-orders": "Purchases",
  "purchase-invoices": "Purchases",
  inventory: "Inventory",
  people: "Accounting",
  accounting: "Accounting",
  "payment-receipts": "Accounting",
  declaration: "Accounting",
  cheques: "Accounting",
  "bank-accounts": "Accounting",
  tools: "Tools",
  files: "Tools",
  "delivery-challans": "Tools",
  "email-templates": "Tools",
};

export default function AppsManager() {
  const { toast } = useUI();
  const { modules, isEnabled, toggle, enableAll } = useModules();

  const groups = useMemo(() => {
    const byGroup = new Map<string, typeof modules>();
    for (const m of modules) {
      const g = GROUP_BY_ID[m.id] ?? "Tools";
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(m);
    }
    return GROUP_ORDER.filter((g) => byGroup.has(g)).map(
      (g) => [g, byGroup.get(g)!] as const
    );
  }, [modules]);

  const enabled = modules.filter((m) => isEnabled(m.id)).length;

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="px-6 pt-5 pb-4 border-b border-border flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[17px] font-semibold text-foreground">
            Apps &amp; Modules
          </div>
          <div className="text-[13px] text-muted-foreground mt-1">
            Turn off modules you don&apos;t use to keep your sidebar focused.
            Turn them back on any time.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12.5px] text-muted-foreground">
            {enabled} of {modules.length} enabled
          </span>
          <button
            onClick={() => {
              enableAll();
              toast.success("All modules enabled");
            }}
            className="h-8 px-3 rounded-md text-[12.5px] border border-border hover:bg-hover text-foreground cursor-pointer transition-colors"
          >
            Enable all
          </button>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {groups.map(([group, items]) => (
          <div key={group}>
            <div className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              {group}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {items.map((m) => {
                const on = isEnabled(m.id);
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "rounded-lg border p-3 flex items-center gap-3 transition-colors",
                      on ? "border-border bg-card" : "border-border bg-hover/40"
                    )}
                  >
                    <div
                      className={cn(
                        "h-8 w-8 rounded-md grid place-items-center shrink-0",
                        on
                          ? "bg-primary-500/10 text-primary-600 dark:text-primary-400"
                          : "bg-hover text-muted-foreground"
                      )}
                    >
                      <AppIcon name={m.icon} className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-medium text-foreground truncate">
                        {m.label}
                      </div>
                      {m.core && (
                        <div className="text-[11px] text-muted-foreground">
                          Core module
                        </div>
                      )}
                    </div>
                    <button
                      role="switch"
                      aria-checked={on}
                      aria-label={`Toggle ${m.label}`}
                      onClick={() => !m.core && toggle(m.id)}
                      disabled={m.core}
                      title={
                        m.core
                          ? "Core module cannot be disabled"
                          : on
                            ? "Disable"
                            : "Enable"
                      }
                      className={cn(
                        "h-5 w-9 rounded-full transition-colors shrink-0",
                        on ? "bg-primary-400" : "bg-border",
                        m.core ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
                      )}
                    >
                      <span
                        className={cn(
                          "block h-4 w-4 rounded-full bg-white shadow transition-transform",
                          on ? "translate-x-4" : "translate-x-0.5"
                        )}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
