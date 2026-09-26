// Accent color system (Emergent reference) — 7 switchable accents driving
// chart colors and highlighted UI. Persisted per device; applied as
// `data-accent` on <html>. Reactivity via the shared "filey-ui" window
// event (also fired on theme change — see theme.ts).
import { useSyncExternalStore } from "react";
import { readAppearanceCookie, writeAppearanceCookie } from "./appearanceCookie";

export const accentPalette = {
  amber: { hex: "#faca1a", name: "Filey yellow", soft: "#fdd86a" },
  blue: { hex: "#3b82f6", name: "Blue", soft: "#60a5fa" },
  emerald: { hex: "#10b981", name: "Emerald", soft: "#34d399" },
  rose: { hex: "#f43f5e", name: "Rose", soft: "#fb7185" },
  violet: { hex: "#8b5cf6", name: "Violet", soft: "#a78bfa" },
  sky: { hex: "#0ea5e9", name: "Sky", soft: "#38bdf8" },
  slate: { hex: "#64748b", name: "Slate", soft: "#94a3b8" },
} as const;

export type AccentKey = keyof typeof accentPalette;

const KEY = "filey-accent";

export function getAccent(): AccentKey {
  let v: string | null | undefined;
  try { v = localStorage.getItem(KEY); } catch { /* cookie fallback */ }
  v ??= readAppearanceCookie("accent");
  return v && Object.prototype.hasOwnProperty.call(accentPalette, v) ? (v as AccentKey) : "amber";
}

export function applyAccent(a: AccentKey = getAccent()): void {
  document.documentElement.dataset.accent = a;
  // Notify theme-aware hooks (useChartColors etc.) — without this, a caller
  // applying the accent after React mounted leaves subscribers stale.
  window.dispatchEvent(new Event("filey-ui"));
}

export function setAccent(a: AccentKey): void {
  try { localStorage.setItem(KEY, a); } catch { /* cookie fallback */ }
  writeAppearanceCookie("accent", a);
  applyAccent(a);
}

function subscribe(cb: () => void): () => void {
  window.addEventListener("filey-ui", cb);
  return () => window.removeEventListener("filey-ui", cb);
}

function snapshot(): string {
  const dark = document.documentElement.classList.contains("dark");
  return `${dark ? "dark" : "light"}:${getAccent()}`;
}

export function useAccent(): { accent: AccentKey; setAccent: (a: AccentKey) => void } {
  const snap = useSyncExternalStore(subscribe, snapshot);
  return { accent: snap.split(":")[1] as AccentKey, setAccent };
}

/** Theme-aware recharts palette (reference useChartColors, verbatim). */
export function useChartColors() {
  const snap = useSyncExternalStore(subscribe, snapshot);
  const [mode, accent] = snap.split(":");
  const a = accentPalette[accent as AccentKey] || accentPalette.amber;
  if (mode === "dark") {
    return {
      primary: "#f4f4f5",
      secondary: a.hex,
      accent: a.hex,
      accentSoft: a.soft,
      tertiary: "#71717a",
      grid: "#1f1f1f",
      axis: "#a1a1aa",
      tooltipBg: "#0e0e0e",
      tooltipBorder: "#262626",
      tooltipFg: "#ededed",
      barGradTop: a.soft,
      barGradBottom: "#3a3a3a",
    };
  }
  return {
    primary: "#18181b",
    secondary: a.hex,
    accent: a.hex,
    accentSoft: a.soft,
    tertiary: "#9ca3af",
    grid: "#e4e4e7",
    axis: "#71717a",
    tooltipBg: "#ffffff",
    tooltipBorder: "#e4e4e7",
    tooltipFg: "#18181b",
    barGradTop: "#374151",
    barGradBottom: a.soft,
  };
}
