import { useMemo } from "react";
import { useModules } from "../../lib/modules";
import { useUI } from "../../lib/ui";
import { SettingsPanel, SettingsSection } from "../../components/SettingsLayout";
import { Toggle } from "./PreferencesPanel";
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
  "Service",
  "Team",
  "Tools",
  "System",
];

/** Presentation grouping only — the registry itself stays flat. */
const GROUP_BY_ID: Record<string, string> = {
  agent: "Assistant",
  overview: "Business",
  reports: "Business",
  settings: "System",
  integrations: "System",
  marketing: "Sales",
  projects: "Service",
  helpdesk: "Service",
  team: "Team",
  comms: "Team",
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
    <SettingsPanel>
      <SettingsSection
        title="Your workspace"
        description="Choose which modules appear in the sidebar. You can turn them back on at any time."
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{enabled}</span> of{" "}
            {modules.length} modules enabled
          </p>
          <button
            onClick={() => {
              enableAll();
              toast.success("All modules enabled");
            }}
            className="btn-ghost"
          >
            Enable all
          </button>
        </div>
      </SettingsSection>
      {groups.map(([group, items]) => (
        <SettingsSection key={group} title={group}>
          <div className="divide-y divide-border">
            {items.map((module) => (
              <div
                key={module.id}
                className="flex min-w-0 items-center gap-3 py-3 first:pt-0 last:pb-0"
              >
                <AppIcon
                  name={module.icon}
                  className="h-5 w-5 shrink-0 text-muted-foreground"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {module.label}
                    {module.core && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        Always on
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {module.desc}
                  </p>
                </div>
                <Toggle
                  label={`Toggle ${module.label}`}
                  on={isEnabled(module.id)}
                  onChange={() => {
                    if (!module.core) toggle(module.id);
                  }}
                  disabled={module.core}
                />
              </div>
            ))}
          </div>
        </SettingsSection>
      ))}
    </SettingsPanel>
  );
}
