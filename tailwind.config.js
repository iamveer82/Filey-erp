/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Primary — trust blue (professional ERP/CRM accent).
        // `primary-400` is the canonical action color used by .btn-primary,
        // focus rings and active chips; darker steps drive hover/press.
        primary: {
          50: "#FFFBE6",
          100: "#FFF5C2",
          200: "#FFEB8A",
          300: "#FFE152",
          400: "#FFD600",
          500: "#E5C100",
          600: "#CCAC00",
          700: "#998100",
          800: "#665600",
          900: "#332B00",
        },
        // Secondary — amber accent for subtle highlights.
        secondary: {
          DEFAULT: "#FFBA3D",
          400: "#FFBA3D",
          500: "#F5A623",
          600: "#E0900F",
        },
        // `brand-*` is the neutral utility ramp (shadcn-style theme). Tuned to
        // a cool *slate* (vs flat grey) so neutrals pair with the trust-blue
        // primary and read more enterprise: light end = quiet surfaces /
        // hairlines, mid/dark = readable text. Values track Tailwind slate.
        brand: {
          50: "#F8FAFC",
          100: "#F1F5F9",
          200: "#E2E8F0",
          300: "#CBD5E1",
          400: "#94A3B8",
          500: "#64748B",
          600: "#475569",
          700: "#334155",
          800: "#1E293B",
          900: "#0F172A",
        },
        // emerald-* kept as an alias so existing usages render success-green
        emerald: {
          400: "#22C55E",
          500: "#16A34A",
          600: "#15803D",
        },
        // design.md §2 — exact spec hex
        success: "#3FB984",
        info: "#0EA5E9",
        warning: "#F59E0B",
        danger: "#E5484D",
        accentpurple: "#7C3AED",
        // Primary text — slate-900 (cool near-black) to match the slate ramp.
        ink: "#0F172A",
        surface: "#F1F5F9",
        background: "#F8FAFC",
        // App canvas — a faint cool white so white cards lift off it cleanly.
        canvas: "#F8FAFC",
        hairline: "#E2E8F0",
        chartdark: "#1E293B",
        // shadcn-style aliases so pasted components (Folder, FileCard) work.
        foreground: "#0F172A",
        border: "#E2E8F0",
      },
      fontFamily: {
        // Linear-style dense UI face for body/navigation/data. Self-hosted via
        // @fontsource-variable/inter (imported in main.tsx) — no CDN, works
        // offline. "Inter Variable" is the variable-font family name; plain
        // "Inter" kept as a fallback.
        sans: ['"Inter Variable"', '"Inter"', "system-ui", "-apple-system", "sans-serif"],
        // Plus Jakarta Sans is referenced but not bundled — falls back to Inter
        // (same as before). Self-host it to honour design.md if desired.
        display: ['"Plus Jakarta Sans"', '"Inter Variable"', '"Inter"', "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
        serif: ['"Lora"', "Georgia", "serif"],
      },
      letterSpacing: {
        tighter: "-0.04em",
        tight: "-0.025em",
        normal: "0",
        wide: "0.025em",
      },
      spacing: {
        // Fractional / large steps used by the Folder & FileCard art.
        "0.75": "0.1875rem",
        "3.25": "0.8125rem",
        "5.5": "1.375rem",
        "18": "4.5rem",
        "30": "7.5rem",
      },
      fontSize: {
        h1: ["32px", { lineHeight: "40px", fontWeight: "700" }],
        h2: ["24px", { lineHeight: "32px", fontWeight: "600" }],
        h3: ["18px", { lineHeight: "28px", fontWeight: "500" }],
        body: ["14px", { lineHeight: "22px" }],
        caption: ["12px", { lineHeight: "18px" }],
      },
      borderRadius: {
        // Minimal scale — buttons 12px (xl), cards 16px (2xl).
        sm: "0.375rem",
        DEFAULT: "0.5rem",
        lg: "0.625rem",
        xl: "0.75rem",
        "2xl": "1rem",
        "3xl": "1.25rem",
      },
      boxShadow: {
        // Quiet elevation only — no colored glows.
        bento: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        "bento-hover": "0 2px 8px 0 rgb(0 0 0 / 0.08)",
        glow: "0 2px 8px 0 rgb(0 0 0 / 0.08)",
        "glow-sm": "0 1px 4px 0 rgb(0 0 0 / 0.06)",
        sheen: "none",
        "sheen-dark": "none",
      },
      backgroundImage: {
        // `bg-cta` resolves to the flat primary yellow.
        cta: "linear-gradient(0deg, #FFD600, #FFD600)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        // design.md motion: page content fades in ≤150ms, opacity only.
        "fade-up": "fade-up 0.15s ease-out both",
        "fade-in": "fade-in 0.15s ease-out both",
      },
    },
  },
  plugins: [],
};
