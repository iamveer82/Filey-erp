import { useSettings, Toggle } from "./PreferencesPanel";
import { SettingsPanel, SettingsSection } from "../../components/SettingsLayout";

export default function NotificationsPanel() {
  const { get, set, ready } = useSettings();
  const items = [
    ["notif.lowstock", "Low-stock alerts", "When a product reaches its reorder level."],
    ["notif.neworder", "New order received", "When a sales order is created."],
    ["notif.quote", "Quotation accepted", "When a customer accepts a quotation."],
    [
      "notif.weekly",
      "Weekly Reports reminder",
      "A reminder to review Reports when you open Filey on Monday.",
    ],
  ];
  if (!ready)
    return (
      <div
        className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground"
        role="status"
      >
        Loading notifications…
      </div>
    );
  return (
    <SettingsPanel>
      <SettingsSection
        title="In-app notifications"
        description="Choose the updates that deserve your attention while Filey is open."
      >
        <div className="divide-y divide-border">
          {items.map(([key, title, description]) => (
            <label
              key={key}
              className="flex items-center justify-between gap-5 py-4 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                  {description}
                </p>
              </div>
              <Toggle
                label={title}
                on={get(key, "on") === "on"}
                onChange={(v) => void set(key, v ? "on" : "off")}
              />
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Changes save automatically to your workspace.
        </p>
      </SettingsSection>
    </SettingsPanel>
  );
}
