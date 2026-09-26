import { beforeEach, expect, it, vi } from "vitest";
import { deliverFile } from "../agentFiles";
import { writeDocFile, saveBytes } from "../localPaths";

vi.mock("../localPaths", () => ({
  hasTauri: true, getExportDir: () => "C:/Exports",
  writeDocFile: vi.fn(), saveBytes: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());

it("keeps repeated exports separate and never opens a save dialog after failure", async () => {
  vi.mocked(writeDocFile).mockImplementation(async (dir, name) => `${dir}/${name}`);
  const file = { name: "Invoice.pdf", bytes: new Uint8Array([1, 2, 3]) };
  const first = await deliverFile(file);
  const second = await deliverFile(file);
  expect(first.path).toMatch(/^C:\/Exports\/Filey AI\/[^/]+\/Invoice.pdf$/);
  expect(first.path).not.toBe(second.path);
  expect(second.name).toBe(file.name);
  vi.mocked(writeDocFile).mockRejectedValueOnce(new Error("Disk full"));
  expect(await deliverFile(file)).toEqual({ name: file.name });
  expect(saveBytes).not.toHaveBeenCalled();
});
