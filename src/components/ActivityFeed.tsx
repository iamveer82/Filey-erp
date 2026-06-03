import { useEffect, useState } from "react";
import { Clock, Activity, FileText, Package, Users, ShoppingCart, Truck, CreditCard, Landmark, Wrench, Layers, Trash2 } from "lucide-react";
import { getRecentAudit, type AuditEntry, formatAuditEntry, clearAuditLog } from "../lib/audit";
import { useUI } from "../lib/ui";

const ICON_MAP: Record<string, React.ComponentType<{ size?: number }>> = {
  product: Package,
  inventory: Layers,
  order: ShoppingCart,
  invoice: FileText,
  quote: FileText,
  customer: Users,
  supplier: Users,
  purchase: Truck,
  payment: CreditCard,
  account: Landmark,
  tool: Wrench,
};

function getIcon(entity: string) {
  for (const [key, Icon] of Object.entries(ICON_MAP)) {
    if (entity.toLowerCase().includes(key)) return Icon;
  }
  return Activity;
}

export default function ActivityFeed() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const { confirm, toast } = useUI();

  const refresh = () => setEntries(getRecentAudit(15));
  useEffect(refresh, []);

  // Refresh every 30 seconds
  useEffect(() => {
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, []);

  if (entries.length === 0) {
    return (
      <div className="card p-6">
        <h3 className="font-bold text-ink flex items-center gap-2 mb-3">
          <Activity size={18} /> Activity
        </h3>
        <p className="text-sm text-brand-400">No activity yet. Your recent actions will appear here.</p>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-ink flex items-center gap-2">
          <Activity size={18} /> Activity
        </h3>
        <button
          className="text-xs text-brand-400 hover:text-danger transition-colors cursor-pointer"
          onClick={async () => {
            const ok = await confirm({ title: "Clear activity log", message: "Clear all activity entries?", confirmLabel: "Clear", danger: true });
            if (!ok) return;
            clearAuditLog();
            refresh();
            toast.success("Activity log cleared.");
          }}
        >
          <Trash2 size={12} /> Clear
        </button>
      </div>
      <div className="space-y-1 max-h-[400px] overflow-y-auto">
        {entries.map((entry) => {
          const Icon = getIcon(entry.entity);
          const time = new Date(entry.timestamp).toLocaleTimeString("en-AE", { hour: "2-digit", minute: "2-digit" });
          const date = new Date(entry.timestamp).toLocaleDateString("en-AE", { month: "short", day: "numeric" });
          return (
            <div
              key={entry.id}
              className="flex items-start gap-3 px-3 py-2 rounded-xl hover:bg-brand-50 transition-colors group"
            >
              <div className="w-8 h-8 rounded-lg bg-primary-50 grid place-items-center shrink-0 mt-0.5">
                <Icon size={14} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink truncate">
                  {formatAuditEntry(entry)}
                </p>
                <p className="text-[11px] text-brand-400 flex items-center gap-1 mt-0.5">
                  <Clock size={10} />
                  {date} {time}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
