import { describe, expect, it, vi } from "vitest";

vi.mock("../localPaths", () => ({
  hasTauri: true,
  getExportDir: () => "C:/Exports",
  writeDocFile: vi.fn(async (dir: string, name: string) => `${dir}/${name}`.replace(/\//g, "\\")),
}));
vi.mock("../nativePlatform", () => ({ isNativeApp: () => false, nativeFileUrl: () => "", saveNativeBytes: vi.fn() }));

import { deliverFile, recentDelivery } from "../agentFiles";

describe("reopening Filey's own output", () => {
  it("finds a delivered file by the path it reported, by name, or by part of the name", async () => {
    const delivered = await deliverFile({ name: "Resume - signed.pdf", bytes: new Uint8Array([1, 2, 3]) });
    expect(delivered.path).toMatch(/^C:\\Exports\\Filey AI\\.+\\Resume - signed\.pdf$/);
    expect(recentDelivery(delivered.path!)?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(recentDelivery("resume - signed.pdf")?.name).toBe("Resume - signed.pdf");
    expect(recentDelivery("C:\\Users\\someone\\Desktop\\Resume - signed.pdf")?.name).toBe("Resume - signed.pdf");
    expect(recentDelivery("signed")?.name).toBe("Resume - signed.pdf");
    expect(recentDelivery("invoice.pdf")).toBeUndefined();
  });

  it("keeps only the newest files", async () => {
    for (let i = 0; i < 14; i++) await deliverFile({ name: `file-${i}.pdf`, bytes: new Uint8Array([i]) });
    expect(recentDelivery("file-0.pdf")).toBeUndefined();
    expect(recentDelivery("file-13.pdf")?.bytes).toEqual(new Uint8Array([13]));
  });
});
