import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // The PDF, pdf.js and React-render suites do real work (workers, canvas,
    // font parsing). On a loaded laptop they blow the 5s/10s defaults and fail
    // as "timeout" while the code is fine; CI never noticed because it has the
    // cores. Generous ceilings cost nothing on a passing run — a test that
    // takes 200ms still takes 200ms — and a genuine hang still fails, later.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Unbounded forks on a small dev machine don't just run slow — a worker
    // gets killed mid-run and reports as "Cannot find module", which reads
    // like a broken install. CI has the cores, so leave it alone there.
    maxWorkers: process.env.CI ? undefined : 2,
    // supabase/ holds Deno edge functions + Deno tests (https: imports) — run
    // those with `deno test`, not vitest.
    exclude: [...configDefaults.exclude, "supabase/**"],
  },
});
