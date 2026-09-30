import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ownedToolPath, toolFilename } from "./tool-path.ts";

Deno.test("tool paths reject normalized cross-owner traversal before download", () => {
  for (const path of ["OWNER/../VICTIM/private.pdf", "OWNER/job/../../VICTIM/private.pdf",
    "OWNER/%2e%2e/VICTIM/private.pdf", "OWNER/%252e%252e/VICTIM/private.pdf", "OWNER/./file.pdf",
    "OWNER//file.pdf", "OWNER/file.pdf/", "OWNER\\file.pdf", "OWNER/file\u0000.pdf", "OWNER/file?x.pdf",
    "OWNER/file#x.pdf", "VICTIM/file.pdf", "OWNER/", "OWNER", null])
    assertEquals(ownedToolPath(path, "OWNER"), false);
  assertEquals(ownedToolPath("OWNER/job/Customer invoice.pdf", "OWNER"), true);
  assertEquals(ownedToolPath("OWNER/job/فاتورة.pdf", "OWNER"), true);
});
Deno.test("a supplied filename cannot inject path, query or fragment separators into output storage", () => {
  const filename = toolFilename("../../../VICTIM/invoice?#%2f.pdf");
  assertEquals(ownedToolPath(`OWNER/job/0_${filename}`, "OWNER"), true);
});
