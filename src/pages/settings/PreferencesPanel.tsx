import { Field } from "../../components/ui";
import UpdateCard from "../../components/UpdateCard";
import { tools, billing, CompanyProfile } from "../../lib/api";
import { useUI } from "../../lib/ui";
import { useEffect, useState } from "react";

/* ---------------- Preferences / Notifications (persisted) ------- */

export function useSettings() {
  const { toast } = useUI();
  const [map, setMap] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  useEffect(() => {
    tools
      .settings()
      .then((rows) => {
        const m: Record<string, string> = {};
        rows.forEach((r) => (m[r.key] = r.value));
        setMap(m);
      })
      .catch((e) => toast.error("Failed to load settings: " + (e instanceof Error ? e.message : e)))
      .finally(() => setReady(true));
  }, []);
  const get = (k: string, d = "") => map[k] ?? d;
  const set = async (k: string, v: string) => {
    const prev = map[k];
    setMap((m) => ({ ...m, [k]: v }));
    try {
      await tools.setSetting(k, v);
    } catch (e) {
      // This used to be swallowed as "offline — queued by api layer", which is
      // not what happens: setSetting runs through online(), and that THROWS
      // when there's no connection rather than queueing. The switch stayed
      // flipped, the value was never stored, and the next visit showed the old
      // one — the "settings don't save" report. Put it back and say so.
      setMap((m) => {
        const next = { ...m };
        if (prev === undefined) delete next[k];
        else next[k] = prev;
        return next;
      });
      toast.error(
        "Couldn't save that setting: " + (e instanceof Error ? e.message : String(e))
      );
    }
  };
  return { get, set, ready };
}

export function useBranding() {
  const { get, set, ready } = useSettings();
  return {
    get,
    set,
    brandColor: get("brand_color", "#f59e0b"),
    setBrandColor: (v: string) => set("brand_color", v),
    ready,
  };
}

export function Toggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative w-10 h-6 rounded-full shrink-0 cursor-pointer transition-colors ${
        on ? "bg-primary-400" : "bg-brand-200"
      }`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
          on ? "left-[18px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

export default function PreferencesPanel() {
  const { toast } = useUI();
  const { get, set, ready, brandColor, setBrandColor } = useBranding();
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  useEffect(() => {
    billing.getCompany().then(setCompany).catch((e) => toast.error("Failed to load company profile: " + (e instanceof Error ? e.message : e)));
  }, []);
  if (!ready)
    return <div className="card text-sm text-brand-400">Loading…</div>;
  return (
    <div className="space-y-4">
      <UpdateCard />
      <div className="card">
        <p className="font-bold text-ink">Document defaults</p>
        <p className="text-sm text-brand-500 mt-0.5 mb-4">
          Used to pre-fill new invoices & quotations. Edit these in{" "}
          <b>Company Details</b>.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          {[
            ["Currency", company?.currency ?? "AED"],
            ["Invoice template", company?.default_template ?? "minimal"],
            [
              "Default tax rate",
              `${company?.default_tax_rate ?? 5}%`,
            ],
          ].map(([k, v]) => (
            <div
              key={k as string}
              className="rounded-xl border border-brand-200 p-3"
            >
              <p className="text-xs text-brand-400">{k}</p>
              <p className="font-semibold text-ink capitalize mt-0.5">
                {v}
              </p>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <p className="font-bold text-ink mb-4">App preferences</p>
        <div className="space-y-3 max-w-sm">
          <Field label="Rows per page">
            <input
              type="number"
              className="input"
              placeholder="25"
              defaultValue={get("pref.page_size", "25")}
              onBlur={(e) => set("pref.page_size", e.target.value || "25")}
            />
          </Field>
          <Field label="Brand colour">
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                className="h-10 w-14 rounded-xl border-0 p-0 cursor-pointer"
              />
              <span className="text-sm text-brand-500">{brandColor}</span>
              <span
                className="color-orb ml-auto"
                style={{
                  width: 28,
                  height: 28,
                  "--accent1": brandColor,
                  "--accent2": blend(brandColor, "#f59e0b", 0.3),
                  "--accent3": blend(brandColor, "#FFFFFF", 0.25),
                } as React.CSSProperties}
              />
            </div>
          </Field>
          <label className="flex items-center justify-between">
            <span className="text-sm text-brand-700">
              Show KPI change indicators
            </span>
            <Toggle
              on={get("pref.kpi_delta", "on") === "on"}
              onChange={(v) => set("pref.kpi_delta", v ? "on" : "off")}
            />
          </label>
          <p className="text-[11px] text-brand-400">
            Preferences are saved to your workspace.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Blend two hex colours. amount 0 = a, 1 = b. */
function blend(a: string, b: string, amount: number): string {
  const ah = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const bh = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const rh = Math.round(ah + (bh - ah) * amount);
  const rg = Math.round(ag + (bg - ag) * amount);
  const rb = Math.round(ab + (bb - ab) * amount);
  return `#${rh.toString(16).padStart(2, "0")}${rg.toString(16).padStart(2, "0")}${rb.toString(16).padStart(2, "0")}`;
}
