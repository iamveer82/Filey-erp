import { useSyncExternalStore } from "react";
import { Check, Moon, Sun } from "lucide-react";
import { getTheme, setTheme, type Theme } from "../../lib/theme";
import { getSmoothScroll, setSmoothScroll } from "../../lib/smoothScroll";
import { Toggle } from "./PreferencesPanel";
import { accentPalette, useAccent, type AccentKey } from "../../lib/accent";
import { ORB_PRESETS, setPersona } from "../../lib/ai";
import BloubBot, { useBotSkin } from "../../components/BloubBot";
import { useUI } from "../../lib/ui";
import { cn } from "../../lib/format";

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
  const { toast } = useUI();
  const { theme, setTheme } = useTheme();
  const { accent, setAccent } = useAccent();
  const smooth = useSyncExternalStore(subscribe, getSmoothScroll);

  return (
    <div className="space-y-4">
      {/* Theme mode */}
      <div className="rounded-xl border border-border bg-card">
        <div className="px-6 pt-5 pb-4 border-b border-border">
          <div className="text-[17px] font-semibold text-foreground">
            Modes
          </div>
          <div className="text-[13px] text-muted-foreground mt-1">
            Light for daytime, dark for focus.
          </div>
        </div>
        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ModeCard
            active={theme === "light"}
            onClick={() => setTheme("light")}
            icon={Sun}
            name="Light"
            desc="Clean and airy for daytime work"
            preview="light"
          />
          <ModeCard
            active={theme === "dark"}
            onClick={() => setTheme("dark")}
            icon={Moon}
            name="Dark"
            desc="Easy on the eyes at night"
            preview="dark"
          />
        </div>
      </div>

      {/* Scrolling */}
      <div className="rounded-xl border border-border bg-card">
        <div className="px-6 pt-5 pb-4 border-b border-border">
          <div className="text-[17px] font-semibold text-foreground">
            Scrolling
          </div>
          <div className="text-[13px] text-muted-foreground mt-1">
            How the main panel responds to your mouse wheel.
          </div>
        </div>
        <div className="p-6 flex items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="text-[14px] text-foreground">Smooth scrolling</div>
            <div className="text-[12.5px] text-muted-foreground mt-0.5">
              Eases the wheel instead of jumping line by line. Tables, menus and
              the sidebar always scroll normally, and this turns itself off when
              your system asks for reduced motion.
            </div>
          </div>
          <Toggle on={smooth} onChange={setSmoothScroll} />
        </div>
      </div>

      {/* Accent color */}
      <div className="rounded-xl border border-border bg-card">
        <div className="px-6 pt-5 pb-4 border-b border-border">
          <div className="text-[17px] font-semibold text-foreground">
            Theme colour
          </div>
          <div className="text-[13px] text-muted-foreground mt-1">
            Drives buttons, toggles, highlights and charts across the whole app.
          </div>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {(
              Object.entries(accentPalette) as [
                AccentKey,
                (typeof accentPalette)[AccentKey],
              ][]
            ).map(([key, val]) => (
              <button
                key={key}
                onClick={() => {
                  setAccent(key);
                  toast.success(`Theme colour set to ${val.name}`);
                }}
                className={cn(
                  "p-3 rounded-lg border text-left transition-all cursor-pointer",
                  accent === key
                    ? "border-foreground ring-2 ring-foreground/20"
                    : "border-border hover:border-muted-foreground"
                )}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="h-6 w-6 rounded-full shrink-0 relative shadow-inner"
                    style={{ background: val.hex }}
                  >
                    {accent === key && (
                      <Check
                        className="h-3 w-3 text-white absolute inset-0 m-auto"
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
      </div>

      <AssistantColor />
    </div>
  );
}

/* ---------------- Assistant colour ----------------
   Separate from the accent: the accent belongs to the app's chrome, this is the
   assistant itself, and people pick them apart. Both live on the same device-
   local persona the copilot's own customiser edits, so changing it in either
   place shows up in the other. */

function AssistantColor() {
  const { toast } = useUI();
  const { color } = useBotSkin();

  const pick = (hex: string) => {
    setPersona({ orbColor: hex });
    toast.success("Assistant colour updated");
  };

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="px-6 pt-5 pb-4 border-b border-border">
        <div className="text-[17px] font-semibold text-foreground">
          Filey AI
        </div>
        <div className="text-[13px] text-muted-foreground mt-1">
          The colour the bot is drawn in, wherever it appears. Independent of
          the theme colour.
        </div>
      </div>
      <div className="p-6 flex flex-col sm:flex-row sm:items-center gap-6">
        {/* A live one, not a swatch: this is exactly what the chat will show. */}
        <div className="grid h-[128px] w-[128px] shrink-0 place-items-center rounded-xl bg-hover">
          <BloubBot size={128} state="idle" label="Assistant preview" ambient />
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
                  "h-9 w-9 rounded-full grid place-items-center transition-all cursor-pointer",
                  color.toLowerCase() === hex.toLowerCase()
                    ? "ring-2 ring-foreground ring-offset-2 ring-offset-card"
                    : "hover:scale-105"
                )}
                style={{ background: hex }}
              >
                {color.toLowerCase() === hex.toLowerCase() && (
                  <Check className="h-4 w-4 text-white" strokeWidth={3} />
                )}
              </button>
            ))}
          </div>
          <label className="mt-4 flex items-center gap-3 text-[13px] text-muted-foreground">
            <input
              type="color"
              value={color}
              onChange={(e) => setPersona({ orbColor: e.target.value })}
              className="h-8 w-12 cursor-pointer rounded border border-border bg-transparent p-0.5"
              aria-label="Custom assistant colour"
            />
            Or pick any colour
          </label>
        </div>
      </div>
    </div>
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
        "text-left rounded-lg border p-3 transition-all cursor-pointer",
        active
          ? "border-foreground ring-2 ring-foreground/20"
          : "border-border hover:border-muted-foreground"
      )}
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="h-8 w-8 rounded-lg bg-hover border border-border grid place-items-center text-foreground">
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <div>
          <div className="text-[13px] font-semibold text-foreground">{name}</div>
          <div className="text-[11.5px] text-muted-foreground">{desc}</div>
        </div>
      </div>
      <div
        className="rounded-md overflow-hidden border"
        style={{ borderColor: border }}
      >
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
