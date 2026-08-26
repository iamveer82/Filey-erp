import { useEffect, useState } from "react";
import { Moon, Sun, LogOut, Building2, Cpu, Info } from "lucide-react";
import { billing, type CompanyProfile } from "@shared/api";
import { useAuth } from "@shared/auth";
import { getDisplayCurrency, CURRENCIES, cn } from "@shared/format";
import { applyDisplayCurrency } from "@shared/displayCurrency";
import { setTheme, getTheme } from "@shared/theme";
import { applyAccent, accentPalette } from "@shared/accent";
import { Screen, Card, Field, Spinner } from "@mobile/components/ui";

const isDark = () => document.documentElement.classList.contains("dark");

export default function Settings() {
  const { profile, signOut } = useAuth();
  const [co, setCo] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [dark, setDark] = useState(() => getTheme() === "dark");

  useEffect(() => {
    billing
      .getCompany()
      .then(setCo)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    if (!co) return;
    setSaving(true);
    try {
      await billing.saveCompany(co);
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 1800);
    } finally {
      setSaving(false);
    }
  };

  const toggleTheme = () => {
    const next: "light" | "dark" = isDark() ? "light" : "dark";
    setTheme(next);
    setDark(next === "dark");
  };

  return (
    <Screen title="Settings" subtitle={profile?.email ?? ""}>
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-14 text-[13px] text-muted-foreground">
          <Spinner className="h-5 w-5" /> Loading…
        </div>
      ) : (
        <div className="space-y-4">
          {/* Appearance */}
          <Card className="space-y-4">
            <SectionTitle icon={<Moon size={15} />} label="Appearance" />
            <button
              className="flex w-full items-center justify-between"
              onClick={toggleTheme}
            >
              <span className="flex items-center gap-2.5 text-[14px] text-foreground">
                {dark ? <Moon size={16} /> : <Sun size={16} />} {dark ? "Dark" : "Light"} mode
              </span>
              <span
                className={cn(
                  "relative h-6 w-11 rounded-full transition-colors",
                  dark ? "bg-primary-500" : "bg-muted"
                )}
                style={dark ? { background: "hsl(var(--primary-500))" } : undefined}
              >
                <span
                  className={cn(
                    "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform",
                    dark ? "translate-x-[22px]" : "translate-x-0.5"
                  )}
                />
              </span>
            </button>
            <div>
              <p className="label">Accent</p>
              <div className="flex gap-2.5">
                {(Object.keys(accentPalette) as (keyof typeof accentPalette)[]).map(
                  (key) => {
                    const active = (document.documentElement.dataset.accent || "amber") === key;
                    return (
                      <button
                        key={key}
                        aria-label={accentPalette[key].name}
                        onClick={() => applyAccent(key)}
                        className={cn(
                          "h-8 w-8 rounded-full border-2 transition-transform active:scale-90",
                          active ? "border-foreground" : "border-transparent"
                        )}
                        style={{ background: accentPalette[key].hex }}
                      />
                    );
                  }
                )}
              </div>
            </div>
          </Card>

          {/* Company */}
          <Card className="space-y-3">
            <SectionTitle icon={<Building2 size={15} />} label="Company" />
            <Field label="Business name">
              <input
                className="input"
                value={co?.name ?? ""}
                onChange={(e) => setCo((c) => (c ? { ...c, name: e.target.value } : c))}
              />
            </Field>
            <Field label="TRN">
              <input
                className="input"
                value={co?.trn ?? ""}
                onChange={(e) => setCo((c) => (c ? { ...c, trn: e.target.value } : c))}
              />
            </Field>
            <Field label="Phone">
              <input
                className="input"
                type="tel"
                inputMode="tel"
                value={co?.phone ?? ""}
                onChange={(e) => setCo((c) => (c ? { ...c, phone: e.target.value } : c))}
              />
            </Field>
            <Field label="Address">
              <textarea
                className="textarea"
                rows={2}
                value={co?.address ?? ""}
                onChange={(e) => setCo((c) => (c ? { ...c, address: e.target.value } : c))}
              />
            </Field>
            <button className="btn-primary w-full" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : savedMsg ? "Saved ✓" : "Save company"}
            </button>
          </Card>

          {/* Display currency */}
          <Card className="space-y-2">
            <SectionTitle icon={<Cpu size={15} />} label="Display currency" />
            <div className="flex flex-wrap gap-1.5">
              {CURRENCIES.map((c) => {
                const active = getDisplayCurrency() === c.code;
                return (
                  <button
                    key={c.code}
                    onClick={() => applyDisplayCurrency(c.code)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
                      active
                        ? "border-transparent bg-foreground text-background"
                        : "border-border bg-card text-muted-foreground"
                    )}
                  >
                    {c.code}
                  </button>
                );
              })}
            </div>
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              Restates every total in the app. New documents adopt this currency
              and its tax rules (AED → VAT, INR → GST).
            </p>
          </Card>

          {/* Account */}
          <Card>
            <SectionTitle icon={<Info size={15} />} label="Account" />
            <p className="mb-3 text-[13.5px] text-foreground">{profile?.email}</p>
            <button
              className="btn-ghost w-full !text-danger"
              onClick={() => void signOut()}
            >
              <LogOut size={15} /> Sign out
            </button>
          </Card>

          <p className="pb-2 text-center text-[11px] text-muted-foreground">
            Filey mobile · the desktop app has the full toolbox
          </p>
        </div>
      )}
    </Screen>
  );
}

function SectionTitle({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
      {icon} {label}
    </p>
  );
}
