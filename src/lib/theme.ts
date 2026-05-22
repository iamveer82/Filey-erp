// Light / dark / system theme. Applies a `dark` class on <html>.
export type Theme = "light" | "dark" | "system";

const KEY = "theme";

export function getTheme(): Theme {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

function systemDark(): boolean {
  return (
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function applyTheme(t: Theme = getTheme()): void {
  const dark = t === "dark" || (t === "system" && systemDark());
  document.documentElement.classList.toggle("dark", dark);
}

export function setTheme(t: Theme): void {
  localStorage.setItem(KEY, t);
  applyTheme(t);
}

/** Wire system-preference changes (only matters when theme === system). */
export function watchSystemTheme(): () => void {
  if (typeof matchMedia === "undefined") return () => {};
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const h = () => {
    if (getTheme() === "system") applyTheme("system");
  };
  mq.addEventListener("change", h);
  return () => mq.removeEventListener("change", h);
}
