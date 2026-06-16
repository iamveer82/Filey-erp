import type { CSSProperties } from "react";
import { useBranding } from "../pages/settings/PreferencesPanel";

/* Animated gradient orb (Filey-yellow by default). The CSS lives in index.css
 * under `.color-orb` (uses the @property --angle spin). This component just
 * sizes it and feeds the colour/​blur CSS variables. Adapted from a styled-jsx
 * source to our plain-CSS + Tailwind setup.
 *
 * Respects the user's brand colour from Settings > Preferences. */

interface OrbTones {
  base?: string;
  accent1?: string;
  accent2?: string;
  accent3?: string;
}

interface ColorOrbProps {
  dimension?: string;
  className?: string;
  tones?: OrbTones;
  spinDuration?: number;
}

const DEFAULT_TONES: Required<OrbTones> = {
  base: "#1b1d22",
  accent1: "#FFD600",
  accent2: "#FFBA3D",
  accent3: "#F5C400",
};

/** Build a three-tone palette from any hex brand colour. */
function deriveTones(hex: string): Required<OrbTones> {
  const ok = hex?.startsWith("#") ? hex : DEFAULT_TONES.accent1;
  return {
    base: "#1b1d22",
    accent1: ok,
    accent2: blend(ok, "#FF8C00", 0.3),
    accent3: blend(ok, "#FFFFFF", 0.25),
  };
}

/** Blend two hex colours. amount 0 = a, 1 = b. */
function blend(a: string, b: string, amount: number): string {
  const ah = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const bh = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const rh = Math.round(ah + (bh - ah) * amount);
  const rg = Math.round(ag + (bg - ag) * amount);
  const rb = Math.round(ab + (bb - ab) * amount);
  return `#${rh.toString(16).padStart(2, "0")}${rg.toString(16).padStart(2, "0")}${rb.toString(16).padStart(2, "0")}`;
}

export default function ColorOrb({
  dimension = "24px",
  className,
  tones,
  spinDuration = 20,
}: ColorOrbProps) {
  const { brandColor } = useBranding();
  const palette = tones || deriveTones(brandColor || DEFAULT_TONES.accent1);
  const d = parseInt(dimension.replace("px", ""), 10) || 24;

  const blur = d < 50 ? Math.max(d * 0.008, 1) : Math.max(d * 0.015, 4);
  const contrast = d < 50 ? Math.max(d * 0.004, 1.2) : Math.max(d * 0.008, 1.5);
  const dot = d < 50 ? Math.max(d * 0.004, 0.05) : Math.max(d * 0.008, 0.1);
  const shadow = d < 50 ? Math.max(d * 0.004, 0.5) : Math.max(d * 0.008, 2);
  const mask = d < 30 ? "0%" : d < 50 ? "5%" : d < 100 ? "15%" : "25%";
  const adjContrast = d < 30 ? 1.1 : d < 50 ? Math.max(contrast * 1.2, 1.3) : contrast;

  const style = {
    width: dimension,
    height: dimension,
    "--base": palette.base,
    "--accent1": palette.accent1,
    "--accent2": palette.accent2,
    "--accent3": palette.accent3,
    "--spin-duration": `${spinDuration}s`,
    "--blur": `${blur}px`,
    "--contrast": adjContrast,
    "--dot": `${dot}px`,
    "--shadow": `${shadow}px`,
    "--mask": mask,
  } as CSSProperties;

  return (
    <span
      aria-hidden
      className={`color-orb${className ? ` ${className}` : ""}`}
      style={style}
    />
  );
}
