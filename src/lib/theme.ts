// Light / dark theme. Applies a `dark` class on <html>.
export type Theme = "light" | "dark";

const KEY = "theme";

function systemDark(): boolean {
  return (
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function getTheme(): Theme {
  const v = localStorage.getItem(KEY);
  if (v === "light" || v === "dark") return v;
  // First run: default to the OS preference (not persisted until the user
  // picks). Only ever light or dark afterwards.
  return systemDark() ? "dark" : "light";
}

export function applyTheme(t: Theme = getTheme()): void {
  document.documentElement.classList.toggle("dark", t === "dark");
}

export function setTheme(t: Theme): void {
  localStorage.setItem(KEY, t);
  applyTheme(t);
}
