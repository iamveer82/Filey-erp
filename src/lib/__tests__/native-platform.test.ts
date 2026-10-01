import { beforeEach, expect, it, vi } from "vitest";
import { deliverFile } from "../agentFiles";
import { openBilling } from "../billingService";
import { publicAppBase } from "../documentMessage";
import { openNativeExternal, openNativeMessage, saveNativeBytes, shareNativeFile } from "../nativePlatform";

const native = vi.hoisted(() => ({
  open: vi.fn(), launch: vi.fn(), write: vi.fn(), read: vi.fn(), share: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios", convertFileSrc: (uri: string) => `https://localhost/_capacitor_file_${uri.slice(7)}` } }));
vi.mock("@capacitor/browser", () => ({ Browser: { open: native.open } }));
vi.mock("@capacitor/app-launcher", () => ({ AppLauncher: { openUrl: native.launch } }));
vi.mock("@capacitor/filesystem", () => ({ Directory: { Data: "DATA", Cache: "CACHE" }, Filesystem: {
  writeFile: native.write, readFile: native.read,
  getUri: async ({ directory, path }: { directory: string; path: string }) => ({ uri: `file:///native/${directory}/${path}` }),
} }));
vi.mock("@capacitor/share", () => ({ Share: { share: native.share } }));
vi.mock("../localPaths", () => ({ hasTauri: false }));
vi.mock("../supabase", () => ({ supabase: null, invokeFn: vi.fn() }));
vi.mock("../api", () => ({ billing: {}, getCacheScope: () => "native-account" }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  native.open.mockResolvedValue(undefined);
  native.launch.mockResolvedValue({ completed: true });
  native.read.mockResolvedValue({ data: "AAH/" });
  native.write.mockImplementation(async ({ directory, path }) => ({ uri: `file:///native/${directory}/${path}` }));
  native.share.mockResolvedValue({ activityType: "" });
});

it("keeps valid external checkout outside the WebView and refuses dangerous links", async () => {
  expect(publicAppBase()).toBe("https://app.gofiley.com/");
  vi.stubEnv("VITE_PUBLIC_APP_URL", "https://selfhost.example.com/filey/");
  expect(publicAppBase()).toBe("https://selfhost.example.com/filey/");
  for (const url of ["javascript:alert(1)", "http://example.com", "https://user:password@example.com", "https://example.com:444"])
    await expect(openNativeExternal(url)).rejects.toThrow();
  expect(native.open).not.toHaveBeenCalled();
  await expect(openBilling("https://checkout.dodopayments.com/session")).resolves.toBe("browser");
  expect(native.open).toHaveBeenCalledWith({ url: "https://checkout.dodopayments.com/session" });
  await expect(openBilling("https://example.com/session")).rejects.toThrow();
  await expect(openNativeMessage("sms:../../secret")).rejects.toThrow();
  await expect(openNativeMessage("mailto:hello@example.com?attach=file:///secret.db")).rejects.toThrow();
  await expect(openNativeMessage("mailto:hello@example.com%0D%0ABcc:other@example.com")).rejects.toThrow();
  await openNativeMessage("sms:+971501234567&body=Hello%20there");
  expect(native.launch).toHaveBeenCalledWith({ url: "sms:+971501234567&body=Hello%20there" });
});

it("rejects traversal and shares only generated output files", async () => {
  for (const name of ["../invoice.pdf", "folder/invoice.pdf", "folder\\invoice.pdf", "..", "bad\0.pdf"])
    await expect(saveNativeBytes(name, new Uint8Array([1]))).rejects.toThrow();
  expect(native.write).not.toHaveBeenCalled();
  for (const uri of ["file:///native/DATA/secrets.db", "https://example.com/invoice.pdf", "file:///native/DATA/filey-exports/x%2f..%2f..%2fsecret.db"])
    await expect(shareNativeFile(uri)).rejects.toThrow();
  expect(native.read).not.toHaveBeenCalled();
  expect(native.share).not.toHaveBeenCalled();
  await shareNativeFile("file:///native/DATA/filey-exports/run/invoice.pdf");
  expect(native.write).toHaveBeenCalledWith(expect.objectContaining({ directory: "CACHE", data: "AAH/" }));
  expect(native.share).toHaveBeenCalledWith(expect.objectContaining({ files: [expect.stringContaining("/CACHE/filey-exports/")] }));
});

it("keeps autonomous output durable without a dialog and treats cancellation separately from failure", async () => {
  const result = await deliverFile({ name: "invoice.pdf", bytes: new Uint8Array([0, 1, 255]) });
  expect(result.path).toContain("/DATA/filey-exports/");
  expect(result.url).toContain("/_capacitor_file_");
  expect(native.write).toHaveBeenCalledWith(expect.objectContaining({ data: "AAH/", directory: "DATA" }));
  expect(native.share).not.toHaveBeenCalled();
  native.share.mockRejectedValue(new Error("Share canceled"));
  await expect(saveNativeBytes("invoice.pdf", new Uint8Array([1]))).resolves.toBeNull();
  native.share.mockRejectedValue(new Error("Storage unavailable"));
  await expect(saveNativeBytes("invoice.pdf", new Uint8Array([1]))).rejects.toThrow("Storage unavailable");
});
