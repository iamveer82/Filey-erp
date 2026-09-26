import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { PDF_TOOLS } from "../PdfToolbox";

it("ships a separate, non-duplicate WebP cover for every registered tool", () => {
  const cover = (id: string) => resolve("public/tool-covers/tools", `${id}.webp`);
  expect(PDF_TOOLS.filter(t => !existsSync(cover(t.id))).map(t => t.id), "tools without a cover").toEqual([]);
  const hashes = new Set<string>();
  for (const tool of PDF_TOOLS) {
    const bytes = readFileSync(cover(tool.id));
    expect(bytes.subarray(0, 4).toString(), tool.id).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString(), tool.id).toBe("WEBP");
    const hash = createHash("sha256").update(bytes).digest("hex");
    expect(hashes.has(hash), `${tool.id} repeats another tool's cover`).toBe(false);
    hashes.add(hash);
  }
  expect(hashes.size).toBe(PDF_TOOLS.length);
});
