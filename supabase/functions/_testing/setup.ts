// Minimal Deno global for running the edge-function test files under
// vitest/node. Under real Deno this file never loads (native Deno.test/env
// are used), so behavior is identical in both runtimes.
import { it } from "vitest";

const g = globalThis as Record<string, unknown>;
if (!("Deno" in g)) {
  g.Deno = {
    test: (name: string, fn: () => unknown | Promise<unknown>) => it(name, fn),
    env: {
      get: (key: string) => process.env[key],
      set: (key: string, value: string) => void (process.env[key] = value),
    },
  };
}
