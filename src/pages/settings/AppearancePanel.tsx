import { useSyncExternalStore } from "react";
import { Check, Moon, Sun } from "lucide-react";
import { getTheme, setTheme, type Theme } from "../../lib/theme";
import { getSmoothScroll, setSmoothScroll } from "../../lib/smoothScroll";
import { Toggle } from "./PreferencesPanel";
import { accentPalette, useAccent, type AccentKey } from "../../lib/accent";
import { ORB_PRESETS, setPersona } from "../../lib/ai";
import BloubBot, { useBotSkin } from "../../components/BloubBot";
import { cn } from "../../lib/format";
import { SettingsPanel, SettingsSection } from "../../components/SettingsLayout";

/* ---------------- Appearance — theme mode + accent color ----------------
   Reference Settings "Preferences" layout, wired to the real stores:
   lib/theme.ts (light/dark, `dark` class on <html>) and lib/accent.ts
   (`data-accent` on <html>). Both persist to localStorage and apply
   immediately; the shared "filey-ui" window event keeps subscribers
   (charts, the header theme toggler) in sync. */

function subscribe(cb: () => void): () => void {
  window.addEventListener("filey-ui", cb);
  return () => window.removeEventListener("filey-ui", cb);
}

/** Reactive theme value — stays in sync when the header toggler flips it. */
function useTheme(): { theme: Theme; setTheme: (t: Theme) => void } {
  const theme = useSyncExternalStore(subscribe, getTheme);
  return { theme, setTheme };
}

export default function AppearancePanel() {
  const { theme, setTheme } = useTheme();
  const { accent, setAccent } = useAccent();
  const smooth = useSyncExternalStore(subscribe, getSmoothScroll);

  return (
    <SettingsPanel>
      {/* Theme mode */}
      <SettingsSection title="Theme" description="Choose a light or dark workspace.">
        <div className="grid max-w-xl grid-cols-2 gap-3">
          <ModeCard
            active={theme === "light"}
            onClick={() => setTheme("light")}
            icon={Sun}
            name="Light"
            desc="A bright workspace"
            preview="light"
          />
          <ModeCard
            active={theme === "dark"}
            onClick={() => setTheme("dark")}
            icon={Moon}
            name="Dark"
            desc="A quieter workspace"
            preview="dark"
          />
        </div>
      </SettingsSection>

      {/* Scrolling */}
      <SettingsSection title="Scrolling" description="Adjust how the workspace moves.">
        <label className="flex max-w-xl items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="text-[14px] text-foreground">Smooth scrolling</div>
            <div className="text-[13px] leading-relaxed text-muted-foreground mt-1.5">
              Gently ease mouse-wheel scrolling. Your system's reduced-motion preference
              takes priority.
            </div>
          </div>
          <Toggle on={smooth} onChange={setSmoothScroll} />
        </label>
      </SettingsSection>

      {/* Accent color */}
      <SettingsSection
        title="Accent colour"
        description="Used for buttons, selections and charts."
      >
        <div>
          <div className="flex max-w-xl flex-wrap gap-2">
            {(
              Object.entries(accentPalette) as [
                AccentKey,
                (typeof accentPalette)[AccentKey],
              ][]
            ).map(([key, val]) => (
              <button
                key={key}
                aria-pressed={accent === key}
                onClick={() => {
                  setAccent(key);
                  // Selection is instantly visible (ring + check) — no toast needed.
                }}
                className={cn(
                  "min-h-10 px-3 rounded-full border text-left transition-colors cursor-pointer",
                  accent === key
                    ? "border-foreground bg-hover"
                    : "border-border hover:bg-hover"
                )}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="h-4 w-4 rounded-full shrink-0 relative"
                    style={{ background: val.hex }}
                  >
                    {accent === key && (
                      <Check
                        className="h-3 w-3 rounded-full bg-white text-black absolute inset-0 m-auto"
                        strokeWidth={3}
                      />
                    )}
                  </div>
                  <div className="text-[13px] font-medium text-foreground">
                    {val.name}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </SettingsSection>

      <AssistantColor />
    </SettingsPanel>
  );
}

/* ---------------- Assistant colour ----------------
   Separate from the accent: the accent belongs to the app's chrome, this is the
   assistant itself, and people pick them apart. Both live on the same device-
   local persona the copilot's own customiser edits, so changing it in either
   place shows up in the other. */

function AssistantColor() {
  const { color } = useBotSkin();

  const pick = (hex: string) => {
    setPersona({ orbColor: hex });
    // Same — the swatch ring is the feedback.
  };

  return (
    <SettingsSection
      title="Filey AI"
      description="Give your animated assistant its own colour."
    >
      <div className="flex max-w-xl items-center gap-5">
        {/* A live one, not a swatch: this is exactly what the chat will show. */}
        <div className="shrink-0">
          <BloubBot size={64} state="idle" label="Assistant preview" ambient />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-2">
            {ORB_PRESETS.map((hex) => (
              <button
                key={hex}
                onClick={() => pick(hex)}
                aria-label={`Use ${hex}`}
                aria-pressed={color.toLowerCase() === hex.toLowerCase()}
                className={cn(
                  "h-10 w-10 rounded-full grid place-items-center transition-colors cursor-pointer",
                  color.toLowerCase() === hex.toLowerCase()
                    ? "ring-2 ring-foreground ring-offset-2 ring-offset-card"
                    : "hover:ring-2 hover:ring-border"
                )}
                style={{ background: hex }}
              >
                {color.toLowerCase() === hex.toLowerCase() && (
                  <Check
                    className="h-4 w-4 rounded-full bg-white text-black"
                    strokeWidth={2.5}
                  />
                )}
              </button>
            ))}
          </div>
          <label className="mt-4 flex items-center gap-3 text-[13px] text-muted-foreground">
            <input
              type="color"
              value={color}
              onChange={(e) => setPersona({ orbColor: e.target.value })}
              className="h-10 w-14 cursor-pointer rounded-[8px] border border-border bg-transparent p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Custom assistant colour"
            />
            Custom colour
          </label>
        </div>
      </div>
    </SettingsSection>
  );
}

/* ---------------- Atoms ---------------- */

function ModeCard({
  active,
  onClick,
  icon: Icon,
  name,
  desc,
  preview,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  name: string;
  desc: string;
  preview: "light" | "dark";
}) {
  const bg = preview === "dark" ? "#0a0a0a" : "#ffffff";
  const border = preview === "dark" ? "#262626" : "#e5e7eb";
  const text = preview === "dark" ? "#f4f4f5" : "#111827";
  const muted = preview === "dark" ? "#a3a3a3" : "#6b7280";
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "min-w-0 text-left rounded-xl border p-3 transition-colors cursor-pointer",
        active
          ? "border-foreground bg-hover/50"
          : "border-border hover:border-muted-foreground"
      )}
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="h-8 w-8 rounded-lg bg-hover border border-border grid place-items-center text-foreground">
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <div>
          <div className="text-[13px] font-semibold text-foreground">{name}</div>
          <div className="text-[11.5px] text-muted-foreground">{desc}</div>
        </div>
      </div>
      <div className="rounded-md overflow-hidden border" style={{ borderColor: border }}>
        <div style={{ background: bg, padding: 8 }}>
          <div
            style={{
              height: 4,
              width: "40%",
              background: text,
              borderRadius: 4,
            }}
          />
          <div
            style={{
              height: 3,
              width: "70%",
              background: muted,
              borderRadius: 4,
              marginTop: 6,
            }}
          />
          <div
            style={{
              height: 3,
              width: "60%",
              background: muted,
              borderRadius: 4,
              marginTop: 3,
            }}
          />
        </div>
      </div>
    </button>
  );
}
