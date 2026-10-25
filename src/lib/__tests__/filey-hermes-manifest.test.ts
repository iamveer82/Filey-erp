import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { hermesManifest } from "../fileyHermesTools";

// Filey Agent (Hermes) registers these Filey tools as its own from agent/tools/filey_app_manifest.json.
// The file must match the app's schemas; regenerate with WRITE_FILEY_MANIFEST=1.
const file = join(process.cwd(), "agent", "tools", "filey_app_manifest.json");

it("keeps the engine's native Filey tools in step with the app", () => {
  const expected = `${JSON.stringify(hermesManifest(), null, 1)}\n`;
  if (process.env.WRITE_FILEY_MANIFEST === "1") writeFileSync(file, expected);
  expect(readFileSync(file, "utf8")).toBe(expected);
  // Every schema rides on each model call: keep the set lean.
  expect(Buffer.byteLength(JSON.stringify(hermesManifest()))).toBeLessThan(40_000);
});
