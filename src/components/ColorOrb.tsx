import type { CSSProperties } from "react";

/* Animated gradient orb (Filey-yellow by default). The CSS lives in index.css
 * under `.color-orb` (uses the @property --angle spin). This component just
 * sizes it and feeds the colour/​blur CSS variables. Adapted from a styled-jsx
 * source to our plain-CSS + Tailwind setup. */

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

const FILEY_TONES: Required<OrbTones> = {
  base: "#1b1d22",
  accent1: "#FFD600",
  accent2: "#FFBA3D",
  accent3: "#F5C400",
};

export default function ColorOrb({
  dimension = "24px",
  className,
  tones,
  spinDuration = 20,
}: ColorOrbProps) {
  const palette = { ...FILEY_TONES, ...tones };
  const d = parseInt(dimension.replace("px", ""), 10) || 24;

  const blur = d < 50 ? Math.max(d * 0.008, 1) : Math.max(d * 0.015, 4);
  const contrast = d < 50 ? Math.max(d * 0.004, 1.2) : Math.max(d * 0.008, 1.5);
  const dot = d < 50 ? Math.max(d * 0.004, 0.05) : Math.max(d * 0.008, 0.1);
  const shadow = d < 50 ? Math.max(d * 0.004, 0.5) : Math.max(d * 0.008, 2);
  const mask = d < 30 ? "0%" : d < 50 ? "5%" : d < 100 ? "15%" : "25%";
  const adjContrast =
    d < 30 ? 1.1 : d < 50 ? Math.max(contrast * 1.2, 1.3) : contrast;

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
