import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { hermesManifest } from "../fileyHermesTools";

// Filey Agent (Hermes) registers these Filey tools as its own from agent/tools/filey_app_manifest.json.
// The file must match the app's schemas; regenerate with WRITE_FILEY_MANIFEST=1.
const file = join(process.cwd(), "agent", "tools", "filey_app_manifest.json");

/** Sent with every model call: everything else is deferred by TOOLS_BLOCK in
 *  src-tauri/src/modules/filey_agent.rs and loads only when a task asks for it. */
const ALWAYS_SENT = ["word", "sheet", "pdf", "filey_computer", "workspace_browser", "list_my_files", "read_attached_document"];

it("keeps the engine's native Filey tools in step with the app", () => {
  const expected = `${JSON.stringify(hermesManifest(), null, 1)}\n`;
  if (process.env.WRITE_FILEY_MANIFEST === "1") writeFileSync(file, expected);
  expect(readFileSync(file, "utf8")).toBe(expected);
});

it("keeps the schemas sent on every call lean, and the deferred set bounded", () => {
  const rows = hermesManifest();
  const size = (list: unknown[]) => Buffer.byteLength(JSON.stringify(list));
  expect(size(rows.filter(row => ALWAYS_SENT.includes(row.hermes_name)))).toBeLessThan(16_000);
  expect(size(rows)).toBeLessThan(50_000);
});
