import { beforeEach, expect, it, vi } from "vitest";
import { downloadCsv } from "../csv";

const save = vi.hoisted(() => vi.fn());
vi.mock("../localPaths", () => ({ hasTauri: true, saveBytes: save }));
beforeEach(() => {
  save.mockReset();
});

it("propagates native export failures so the caller can report them", async () => {
  save.mockRejectedValue(new Error("Folder is read-only"));
  await expect(downloadCsv("customers", [{ name: "North Harbour" }])).rejects.toThrow(
    "Folder is read-only"
  );
  expect(save.mock.calls[0][0]).toBe("customers.csv");
  expect(new TextDecoder().decode(save.mock.calls[0][1])).toBe("name\nNorth Harbour");
});

it("treats cancelling the native save dialog as a normal cancellation", async () => {
  save.mockResolvedValue(null);
  await expect(
    downloadCsv("customers.csv", [{ name: "Company" }])
  ).resolves.toBeUndefined();
});
