import { Field } from "../../components/ui";
import { SettingsPanel, SettingsSection } from "../../components/SettingsLayout";
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
      .catch((e) =>
        toast.error("Failed to load settings: " + (e instanceof Error ? e.message : e))
      )
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
  label,
  disabled = false,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="group relative grid h-10 w-11 shrink-0 cursor-pointer place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        className={`relative block h-6 w-10 rounded-full transition-colors ${on ? "bg-primary-400" : "bg-border"}`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm motion-safe:transition-transform ${on ? "translate-x-4" : "translate-x-0"}`}
        />
      </span>
    </button>
  );
}

export default function PreferencesPanel() {
  const { toast } = useUI();
  const { get, set, ready, brandColor, setBrandColor } = useBranding();
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  useEffect(() => {
    billing
      .getCompany()
      .then(setCompany)
      .catch((e) =>
        toast.error(
          "Failed to load company profile: " + (e instanceof Error ? e.message : e)
        )
      );
  }, []);
  if (!ready)
    return (
      <div
        className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground"
        role="status"
      >
        Loading preferences…
      </div>
    );
  return (
    <SettingsPanel>
      <SettingsSection
        title="Document defaults"
        description="Starting values for new invoices and quotations. Set these in Company Details."
      >
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            ["Currency", company?.currency ?? "AED"],
            ["Invoice template", company?.default_template ?? "minimal"],
            ["Default tax rate", `${company?.default_tax_rate ?? 5}%`],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-sm font-medium capitalize text-foreground">
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <a href="#/settings?section=company" className="btn-ghost">
          Edit document defaults
        </a>
      </SettingsSection>
      <SettingsSection
        title="Workspace preferences"
        description="Choose how information is displayed. Changes save to your workspace when you leave a field."
      >
        <div className="grid max-w-xl gap-4 sm:grid-cols-2">
          <Field label="Rows per page">
            <input
              type="number"
              min="5"
              max="200"
              className="input"
              placeholder="25"
              defaultValue={get("pref.page_size", "25")}
              onBlur={(e) => {
                const n = parseInt(e.target.value, 10);
                const clamped = Number.isFinite(n) ? Math.max(5, Math.min(200, n)) : 25;
                e.target.value = String(clamped);
                void set("pref.page_size", String(clamped));
              }}
            />
          </Field>
          <Field label="Brand colour">
            <div className="flex items-center gap-3">
              <input
                type="color"
                key={brandColor}
                defaultValue={brandColor}
                onBlur={(e) => void setBrandColor(e.target.value)}
                className="h-10 w-14 cursor-pointer rounded-[8px] border border-border bg-card p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span className="text-sm text-muted-foreground">{brandColor}</span>
            </div>
          </Field>
        </div>
        <label className="flex max-w-xl items-center justify-between gap-5 border-t border-border pt-4">
          <span className="text-sm text-foreground">Show KPI change indicators</span>
          <Toggle
            on={get("pref.kpi_delta", "on") === "on"}
            onChange={(v) => void set("pref.kpi_delta", v ? "on" : "off")}
          />
        </label>
      </SettingsSection>
      <UpdateCard />
    </SettingsPanel>
  );
}
