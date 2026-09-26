import { expect, it } from "vitest";
import JSZip from "jszip";
import { fileFromOutput, zipOutputs } from "../pdfTools";

it("bundles all results without duplicate names, path traversal or broken Unicode", async () => {
  const bytes = new TextEncoder().encode("Filey test result");
  const result = zipOutputs(["../test.txt", "same.pdf", "same.pdf", "فاتورة.pdf"].map(name => ({ name, bytes })));
  const zip = await JSZip.loadAsync(result.bytes, { checkCRC32: true });
  expect(Object.keys(zip.files)).toEqual(["_test.txt", "same.pdf", "2-same.pdf", "فاتورة.pdf"]);
  for (const entry of Object.values(zip.files)) expect(await entry.async("string")).toBe("Filey test result");
  const next = fileFromOutput({ name: "result.PDF", bytes });
  expect(next.type).toBe("application/pdf");
  expect(next.size).toBe(bytes.length);
  expect(() => zipOutputs([])).toThrow("no results");
});
