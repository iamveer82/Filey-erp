import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // supabase/ holds Deno edge functions + Deno tests (https: imports) — run
    // those with `deno test`, not vitest.
    exclude: [...configDefaults.exclude, "supabase/**"],
  },
});
