import { Plug } from "lucide-react";
import BrandIcon from "../../components/BrandIcon";
import { Badge } from "../../components/ui";

export default function IntegrationsPanel() {
  const url = (import.meta.env.VITE_SUPABASE_URL as string) || "";
  const host = url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const rows = [
    {
      n: "Supabase",
      d: host || "not configured",
      ok: !!host,
      icon: <BrandIcon name="supabase" className="h-5 w-5" />,
    },
    {
      n: "Local PDF Tools",
      d: "On-device, no network",
      ok: true,
      icon: <BrandIcon name="pdf" className="h-5 w-5" />,
    },
    {
      n: "Email / SMTP",
      d: "Not configured",
      ok: false,
      icon: <BrandIcon name="gmail" className="h-5 w-5" />,
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
      <p className="font-medium text-ink">Integrations</p>
      <p className="text-sm text-brand-500 mt-0.5 mb-4">
        Connected services and their status.
      </p>
      <div className="space-y-2">
        {rows.map((r) => (
          <div
            key={r.n}
            className="flex items-center gap-3 rounded-3xl border border-brand-200 px-4 py-3"
          >
            <span className="rounded-3xl bg-primary-100 text-primary-700 p-2">
              {r.icon}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-ink">{r.n}</p>
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
