import { useEffect, useState } from "react";
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
      className="grid h-8 w-8 place-items-center rounded-md border border-border text-foreground hover:bg-hover transition-colors cursor-pointer outline-none"
    >
      {isDark ? (
        // Sun — show in dark mode to mean "click to brighten"
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        >
          <circle cx="12" cy="12" r="4" />
          <line x1="12" y1="2" x2="12" y2="4" />
          <line x1="12" y1="20" x2="12" y2="22" />
          <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
          <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
          <line x1="2" y1="12" x2="4" y2="12" />
          <line x1="20" y1="12" x2="22" y2="12" />
          <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
          <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
        </svg>
      ) : (
        // Moon — show in light mode to mean "click to dim"
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}
