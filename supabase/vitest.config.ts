// Vitest config for the Supabase edge-function tests. The repo-root config
// excludes supabase/** (those files are written Deno-style), so this config
// exists to run them through Node-side vitest instead:
//
//   npx vitest run -c supabase/vitest.config.ts supabase/functions/channel-webhook/<file>.test.ts
//
// The https: imports the functions use are aliased to local shims / the npm
// @supabase client, and a setup file provides a minimal `Deno` global so the
// same *.test.ts files still run unchanged under real Deno (`deno test`).
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const shim = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "https://deno.land/std@0.224.0/assert/mod.ts",
        replacement: shim("./functions/_testing/deno-assert.ts"),
      },
      {
        find: "https://deno.land/std@0.224.0/http/server.ts",
        replacement: shim("./functions/_testing/deno-server.ts"),
      },
      { find: "https://esm.sh/@supabase/supabase-js@2", replacement: "@supabase/supabase-js" },
    ],
  },
  test: {
    environment: "node",
    include: ["supabase/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
    setupFiles: [shim("./functions/_testing/setup.ts")],
  },
});
