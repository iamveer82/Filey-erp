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
        // `brand-*` is the warm neutral utility ramp. Light end is calmed
        // toward a near-neutral warm grey for quiet surfaces & hairlines;
        // mid/dark tones stay warm for readable text.
        brand: {
          50: "#F2F1EC",
          100: "#E9E7E0",
          200: "#DEDBD2",
          300: "#C7C2B6",
          400: "#A39B8C",
          500: "#867F72",
          600: "#655F54",
          700: "#46423A",
          800: "#312D27",
          900: "#222222",
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
        ink: "#222222",
        surface: "#E4E1D8",
        background: "#F6F5F1",
        canvas: "#F6F5F1",
        hairline: "#E6E3DB",
        chartdark: "#1F1F1F",
      },
      fontFamily: {
        // Body: humanist sans for dense data + long-form readability.
        sans: ['"Open Sans"', "system-ui", "-apple-system", "sans-serif"],
        // Display: geometric Poppins for headings, metrics & UI chrome.
        display: ['"Poppins"', "system-ui", "sans-serif"],
      },
      fontSize: {
        h1: ["32px", { lineHeight: "40px", fontWeight: "700" }],
        h2: ["24px", { lineHeight: "32px", fontWeight: "600" }],
        h3: ["18px", { lineHeight: "28px", fontWeight: "500" }],
        body: ["14px", { lineHeight: "22px" }],
        caption: ["12px", { lineHeight: "18px" }],
      },
      borderRadius: {
        sm: "8px",
        DEFAULT: "12px",
        lg: "12px",
        xl: "12px",
        "2xl": "16px",
        "3xl": "20px",
      },
      boxShadow: {
        // Quiet, flat-leaning elevation — minimal Odoo/Tally feel.
        bento: "0 1px 2px rgba(34,34,34,0.05)",
        "bento-hover":
          "0 2px 4px rgba(34,34,34,0.06), 0 8px 20px rgba(34,34,34,0.07)",
        glow: "0 6px 18px rgba(255,214,0,0.28)",
        "glow-sm": "0 3px 10px rgba(255,214,0,0.20)",
        sheen: "inset 0 1px 0 0 rgba(255,255,255,0.6)",
        "sheen-dark": "inset 0 1px 0 0 rgba(255,255,255,0.05)",
      },
      backgroundImage: {
        // Warm cream page wash (light) — depth without clutter.
        "app-light":
          "radial-gradient(1200px 600px at 12% -10%, #FBF6EA 0%, transparent 55%), radial-gradient(1000px 700px at 100% 0%, #F7EFDC 0%, transparent 50%), linear-gradient(180deg, #F5EDDA 0%, #F1E8D2 100%)",
        "app-dark":
          "radial-gradient(1100px 600px at 10% -10%, #211D15 0%, transparent 55%), radial-gradient(1000px 700px at 100% 0%, #1C1912 0%, transparent 50%), linear-gradient(180deg, #17150F 0%, #141109 100%)",
        // Yellow→amber CTA / hero highlight.
        cta: "linear-gradient(135deg, #FFE066 0%, #FFD600 45%, #FFBA3D 100%)",
        // Glassy card top-light sheen.
        "card-sheen":
          "linear-gradient(180deg, rgba(255,255,255,0.65) 0%, rgba(255,255,255,0) 28%)",
      },
      keyframes: {
        // 100% resolves to `transform: none` so a finished entrance never
        // leaves a containing block / stacking context behind it.
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "none" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.97)" },
          "100%": { opacity: "1", transform: "none" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.4s cubic-bezier(0.2,0,0.2,1) both",
        "fade-in": "fade-in 0.25s ease-out both",
        "scale-in": "scale-in 0.18s cubic-bezier(0.2,0,0.2,1) both",
      },
    },
  },
  plugins: [],
};
