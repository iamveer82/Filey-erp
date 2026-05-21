/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
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
        bento: "0 1px 2px rgba(34,34,34,0.04), 0 4px 16px rgba(34,34,34,0.05)",
        "bento-hover":
          "0 10px 28px rgba(34,34,34,0.10), 0 4px 10px rgba(34,34,34,0.06)",
        glow: "0 8px 24px rgba(255,214,0,0.35)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.35s ease-out both",
      },
    },
  },
  plugins: [],
};
