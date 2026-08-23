/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // ── Token-driven palette (Emergent reference design system). All
        // surface/text colors resolve to hsl CSS vars declared in index.css,
        // so light/dark flip via the `.dark` class with zero per-class hexes.
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        ring: "hsl(var(--ring) / <alpha-value>)",
        sidebar: "hsl(var(--sidebar) / <alpha-value>)",
        hover: "hsl(var(--hover) / <alpha-value>)",
        // Primary — amber CTA (reference: bg-amber-400 text-neutral-900,
        // hover amber-300, border amber-500/60). Tracks Tailwind amber.
        primary: {
          50: "#fffbeb",
          100: "#fef3c7",
          200: "#fde68a",
          300: "#fcd34d",
          400: "#fbbf24",
          500: "#f59e0b",
          600: "#d97706",
          700: "#b45309",
          800: "#92400e",
          900: "#78350f",
        },
        secondary: {
          DEFAULT: "#FFBA3D",
          400: "#FFBA3D",
          500: "#F5A623",
          600: "#E0900F",
        },
        // Legacy `brand-*` ramp — aliased onto the token system so every
        // existing page inherits the new theme without edits. Light end =
        // quiet surfaces/hairlines, mid = muted text, dark = readable text.
        brand: {
          50: "hsl(var(--muted) / <alpha-value>)",
          100: "hsl(var(--muted) / <alpha-value>)",
          200: "hsl(var(--border) / <alpha-value>)",
          300: "hsl(var(--border) / <alpha-value>)",
          400: "hsl(var(--muted-foreground) / <alpha-value>)",
          500: "hsl(var(--muted-foreground) / <alpha-value>)",
          600: "hsl(var(--muted-foreground) / <alpha-value>)",
          700: "hsl(var(--foreground) / <alpha-value>)",
          800: "hsl(var(--foreground) / <alpha-value>)",
          900: "hsl(var(--foreground) / <alpha-value>)",
        },
        // Theme-scoped so each mode gets a value that clears AA as text: the
        // single bright hex these used to be read at 2.1-2.5:1 on white.
        success: "hsl(var(--success) / <alpha-value>)",
        info: "hsl(var(--info) / <alpha-value>)",
        warning: "hsl(var(--warning) / <alpha-value>)",
        danger: "hsl(var(--danger) / <alpha-value>)",
        accentpurple: "#7C3AED",
        // Legacy aliases → tokens (ink = primary text, hairline = border,
        // surface = card, canvas = page background).
        ink: "hsl(var(--foreground) / <alpha-value>)",
        surface: "hsl(var(--card) / <alpha-value>)",
        canvas: "hsl(var(--background) / <alpha-value>)",
        page: "hsl(var(--page) / <alpha-value>)",
        hairline: "hsl(var(--border) / <alpha-value>)",
        chartdark: "#1E293B",
      },
      fontFamily: {
        // Linear-style dense UI face for body/navigation/data. Self-hosted via
        // @fontsource-variable/inter (imported in main.tsx) — no CDN, works
        // offline. "Inter Variable" is the variable-font family name; plain
        // "Inter" kept as a fallback.
        sans: ['"Inter Variable"', '"Inter"', "system-ui", "-apple-system", "sans-serif"],
        // Doc-template faces (invoice/quote print) — kept self-hosted.
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
        // Reference enter: opacity + 4px rise, 250ms ease-out.
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.15s ease-out both",
        "fade-in": "fade-in 0.25s ease-out both",
      },
    },
  },
  plugins: [],
};
