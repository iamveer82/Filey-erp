import { Bell, Plug, Wifi } from "lucide-react";
import { Badge } from "../../components/ui";

export default function IntegrationsPanel() {
  const url = (import.meta.env.VITE_SUPABASE_URL as string) || "";
  const host = url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const rows = [
    {
      n: "Supabase",
      d: host || "not configured",
      ok: !!host,
      icon: <Wifi size={16} />,
    },
    {
      n: "Local PDF Tools",
      d: "On-device, no network",
      ok: true,
      icon: <Plug size={16} />,
    },
    {
      n: "Email / SMTP",
      d: "Not configured",
      ok: false,
      icon: <Bell size={16} />,
    },
    {
      n: "Webhooks / API",
      d: "Not configured",
      ok: false,
      icon: <Plug size={16} />,
    },
  ];
  return (
    <div className="card">
      <p className="font-bold text-ink">Integrations</p>
      <p className="text-sm text-brand-500 mt-0.5 mb-4">
        Connected services and their status.
      </p>
      <div className="space-y-2">
        {rows.map((r) => (
          <div
            key={r.n}
            className="flex items-center gap-3 rounded-xl border border-brand-200 px-4 py-3"
          >
            <span className="rounded-lg bg-primary-100 text-primary-700 p-2">
              {r.icon}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-ink">{r.n}</p>
              <p className="text-[11px] text-brand-400 truncate">{r.d}</p>
            </div>
            <Badge tone={r.ok ? "success" : "neutral"}>
              {r.ok ? "Connected" : "Off"}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
