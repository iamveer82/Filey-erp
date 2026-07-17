import { useModules } from "../../lib/modules";
import { Badge } from "../../components/ui";
import AppIcon from "../../components/AppIcon";

/* ---------------- Apps & Modules ---------------- */

export default function AppsManager() {
  const { modules, isEnabled, toggle } = useModules();
  return (
    <div className="card">
      <p className="font-medium text-ink">Apps &amp; Modules</p>
      <p className="text-sm text-brand-500 mt-0.5 mb-4">
        Turn modules on or off. Disabled modules are hidden from the sidebar and blocked.
        Core modules are always on.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {modules.map((m) => {
          const on = isEnabled(m.id);
          return (
            <div
              key={m.id}
              className="flex items-start gap-3 rounded-xl border border-brand-200 p-4"
            >
              <div className="rounded-xl bg-primary-100 text-ink p-2.5 shrink-0">
                <AppIcon name={m.icon} className="w-[18px] h-[18px]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-ink text-sm">{m.label}</p>
                  {m.core && <Badge tone="neutral">Core</Badge>}
                </div>
                <p className="text-xs text-brand-400 mt-0.5">{m.desc}</p>
              </div>
              <button
                role="switch"
                aria-checked={on}
                aria-label={`Toggle ${m.label}`}
                disabled={m.core}
                onClick={() => toggle(m.id)}
                className={`relative w-10 h-6 rounded-full shrink-0 transition-colors ${
                  m.core ? "cursor-not-allowed" : "cursor-pointer"
                } ${on ? "bg-primary-400" : "bg-brand-200"}`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${
                    on ? "left-[18px]" : "left-0.5"
                  }`}
                />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
