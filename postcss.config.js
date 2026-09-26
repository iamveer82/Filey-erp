export default {
  plugins: {
    // Tailwind 4 ships its own PostCSS plugin and handles vendor
    // prefixing internally (Lightning CSS), so autoprefixer is dropped.
    "@tailwindcss/postcss": {},
  },
}
