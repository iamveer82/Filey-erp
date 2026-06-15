import { useSettings, Toggle } from "./PreferencesPanel";

export default function NotificationsPanel() {
  const { get, set, ready } = useSettings();
  const ITEMS = [
    ["notif.lowstock", "Low-stock alerts", "When a product hits its reorder level"],
    ["notif.neworder", "New order received", "When a sales order is created"],
    ["notif.quote", "Quotation accepted", "When a customer accepts a quote"],
    ["notif.weekly", "Weekly summary", "A digest of activity every Monday"],
  ];
  if (!ready) return <div className="card text-sm text-brand-400">Loading…</div>;
  return (
    <div className="card">
      <p className="font-medium text-ink">Notifications</p>
      <p className="text-sm text-brand-500 mt-0.5 mb-4">
        Choose what you want to be notified about.
      </p>
      <div className="space-y-1">
        {ITEMS.map(([key, title, desc]) => (
          <div
            key={key}
            className="flex items-center justify-between rounded-3xl border border-brand-200 px-4 py-3"
          >
            <div>
              <p className="text-sm font-medium text-ink">{title}</p>
              <p className="text-[11px] text-brand-400">{desc}</p>
            </div>
            <Toggle
              on={get(key, "on") === "on"}
              onChange={(v) => set(key, v ? "on" : "off")}
            />
          </div>
        ))}
      </div>
      <p className="text-[11px] text-brand-400 mt-3">
        Preferences are saved now. Delivery (email/push) activates once a notification
        integration is configured.
      </p>
    </div>
  );
}
