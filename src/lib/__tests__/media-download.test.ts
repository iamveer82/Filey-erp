import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { downloadMedia } from "../mediaDownload";

vi.mock("../localPaths", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../localPaths")>()),
  hasTauri: true,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

it("downloads desktop image bytes through the binary command without forwarding credentials", async () => {
  vi.mocked(invoke).mockResolvedValue({ data: "AAEC/w==", mime: "image/png" });
  const response = await downloadMedia("https://v3.fal.media/test.png");
  expect(invoke).toHaveBeenCalledWith("ai_download_media", {
    url: "https://v3.fal.media/test.png",
  });
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 1, 2, 255]);
  expect(response.headers.get("content-type")).toBe("image/png");
  await expect(downloadMedia("https://user:secret@example.com/file.png")).rejects.toThrow(
    "Invalid media link"
  );
  expect(invoke).toHaveBeenCalledTimes(1);
});
