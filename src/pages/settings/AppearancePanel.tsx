import { useSyncExternalStore } from "react";
import { Check, Moon, Sun } from "lucide-react";
import { getTheme, setTheme, type Theme } from "../../lib/theme";
import { accentPalette, useAccent, type AccentKey } from "../../lib/accent";
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

  return (
    <div className="space-y-4">
      {/* Theme mode */}
      <div className="rounded-xl border border-border bg-card">
        <div className="px-6 pt-5 pb-4 border-b border-border">
          <div className="text-[17px] font-semibold text-foreground">
            Theme mode
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

      {/* Accent color */}
      <div className="rounded-xl border border-border bg-card">
        <div className="px-6 pt-5 pb-4 border-b border-border">
          <div className="text-[17px] font-semibold text-foreground">
            Accent color
          </div>
          <div className="text-[13px] text-muted-foreground mt-1">
            Used for charts, active states and highlights across the app.
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
                  toast.success(`Accent set to ${val.name}`);
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
