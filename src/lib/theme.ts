// Light / dark theme. Applies a `dark` class on <html>.
import { applyAccent } from "./accent";
import { readAppearanceCookie, writeAppearanceCookie } from "./appearanceCookie";
export type Theme = "light" | "dark";

const KEY = "theme";

function systemDark(): boolean {
  return (
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function getTheme(): Theme {
  let v: string | null | undefined;
  try { v = localStorage.getItem(KEY); } catch { /* cookie fallback */ }
  v ??= readAppearanceCookie("theme");
  if (v === "light" || v === "dark") return v;
  // First run: default to the OS preference (not persisted until the user
  // picks). Only ever light or dark afterwards.
  return systemDark() ? "dark" : "light";
}

export function applyTheme(t: Theme = getTheme()): void {
  document.documentElement.classList.toggle("dark", t === "dark");
  // Notify theme-aware hooks (useChartColors in lib/accent.ts).
  window.dispatchEvent(new Event("filey-ui"));
}

export function setTheme(t: Theme): void {
  try { localStorage.setItem(KEY, t); } catch { /* cookie fallback */ }
  writeAppearanceCookie("theme", t);
  applyTheme(t);
}


/** Keep existing tabs in step with the device's saved appearance preferences. */
export function watchAppearance(): () => void {
  const changed = (event: StorageEvent) => {
    if (event.storageArea !== localStorage) return;
    if (event.key === KEY || event.key === null) applyTheme();
    if (event.key === "filey-accent" || event.key === null) applyAccent();
  };
  window.addEventListener("storage", changed);
  return () => window.removeEventListener("storage", changed);
}
