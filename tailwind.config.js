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
        // `brand-*` is the warm neutral utility ramp
        brand: {
          50: "#F8F3E7",
          100: "#F0E9D9",
          200: "#E4DAC6",
          300: "#CBBEAA",
          400: "#A89F8C",
          500: "#8C8475",
          600: "#6B6457",
          700: "#4A453B",
          800: "#332F28",
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
        surface: "#CBBEAA",
        background: "#F3EBD6",
        canvas: "#F3EBD6",
        hairline: "#EAE4D6",
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
        // Layered ambient elevation — soft, warm, multi-stop.
        bento:
          "0 1px 2px rgba(34,34,34,0.04), 0 2px 6px rgba(34,34,34,0.04), 0 10px 28px rgba(34,34,34,0.06)",
        "bento-hover":
          "0 2px 4px rgba(34,34,34,0.06), 0 14px 36px rgba(34,34,34,0.12), 0 6px 16px rgba(255,182,61,0.12)",
        glow: "0 10px 30px rgba(255,214,0,0.40)",
        "glow-sm": "0 4px 14px rgba(255,214,0,0.30)",
        // Inset top highlight that gives surfaces a lit, glassy edge.
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
