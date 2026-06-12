/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Primary — Filey yellow
        primary: {
          50: "#FFFBEB",
          100: "#FFF3C4",
          200: "#FFE885",
          300: "#FFDD47",
          400: "#FFD600",
          500: "#F5C400",
          600: "#E0AE00",
          700: "#B88C00",
          800: "#8F6D00",
          900: "#6B5200",
        },
        // Secondary — warm amber accent
        secondary: {
          DEFAULT: "#FFBA3D",
          400: "#FFBA3D",
          500: "#F5A623",
          600: "#E0900F",
        },
        // `brand-*` is the neutral grey utility ramp (shadcn-style theme):
        // light end = quiet surfaces / hairlines, mid/dark = readable text.
        brand: {
          50: "#F5F5F5",
          100: "#EBEBEB",
          200: "#E7E7EE",
          300: "#D4D4D8",
          400: "#9A9A9A",
          500: "#6E6E6E",
          600: "#525252",
          700: "#3F3F3F",
          800: "#1F1F1F",
          900: "#0A0A0A",
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
        ink: "#0A0A0A",
        surface: "#F5F8FB",
        background: "#FDFDFD",
        canvas: "#FDFDFD",
        hairline: "#E7E7EE",
        chartdark: "#1F1F1F",
        // shadcn-style aliases so pasted components (Folder, FileCard) work.
        foreground: "#0A0A0A",
        border: "#E7E7EE",
      },
      fontFamily: {
        // Single clean geometric sans across the UI (theme: Plus Jakarta Sans).
        sans: ['"Plus Jakarta Sans"', "system-ui", "-apple-system", "sans-serif"],
        display: ['"Plus Jakarta Sans"', "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
        serif: ['"Lora"', "Georgia", "serif"],
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
        // `bg-cta` kept as a token but resolves to flat brand yellow.
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
