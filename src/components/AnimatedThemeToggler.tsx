import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { setTheme, getTheme } from "../lib/theme";

/** Minimal theme toggle — light/dark icon swap, no motion (design.md §0.8).
 * Persists via the app theme store. Click sound removed for the
 * professional/minimal aesthetic. */
export interface AnimatedThemeTogglerProps {
  /** Kept for API compatibility; click sound is no longer emitted. */
  sound?: boolean;
}

export default function AnimatedThemeToggler(_: AnimatedThemeTogglerProps = {}) {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    setIsDark(getTheme() === "dark");
  }, []);

  const toggle = () => {
    const next = isDark ? "light" : "dark";
    setTheme(next);
    setIsDark(next === "dark");
  };

  return (
    <button
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
      className="grid h-8 w-8 place-items-center rounded-full border border-border text-foreground hover:bg-hover transition-colors cursor-pointer outline-none"
    >
      {isDark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    </button>
  );
}
