import { beforeEach, expect, test, vi } from "vitest";
const native = vi.hoisted(() => ({
  enabled: true, platform: "android", style: vi.fn(), overlay: vi.fn(), background: vi.fn(), appListener: vi.fn(), browserListener: vi.fn(),
  launchUrl: vi.fn(), remove: vi.fn(),
}));
vi.mock("./supabase", () => ({ supabase: null }));
vi.mock("./monitoring", () => ({ initMonitoring: vi.fn() }));
vi.mock("./nativePlatform", () => ({ isNativeApp: () => native.enabled }));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => native.platform } }));
vi.mock("@capacitor/app", () => ({ App: { addListener: native.appListener, getLaunchUrl: native.launchUrl } }));
vi.mock("@capacitor/browser", () => ({ Browser: { addListener: native.browserListener } }));
vi.mock("@capacitor/status-bar", () => ({ StatusBar: { setStyle: native.style, setOverlaysWebView: native.overlay, setBackgroundColor: native.background }, Style: { Dark: "DARK", Light: "LIGHT" } }));
import { nativeAppRoute, startNativeLifecycle } from "./nativeLifecycle";
import { applyTheme } from "./theme";

beforeEach(() => {
  vi.clearAllMocks();
  native.enabled = true;
  native.platform = "android";
  native.style.mockResolvedValue(undefined);
  native.overlay.mockResolvedValue(undefined);
  native.background.mockResolvedValue(undefined);
  native.appListener.mockResolvedValue({ remove: native.remove });
  native.browserListener.mockResolvedValue({ remove: native.remove });
  native.launchUrl.mockResolvedValue(undefined);
  native.remove.mockResolvedValue(undefined);
  document.documentElement.classList.remove("dark");
});

test("mobile links only navigate allowed destinations and never import a session", () => {
  expect(nativeAppRoute("filey://app/settings")).toBe("/settings");
  expect(nativeAppRoute("filey://app/settings?section=credits&credit_checkout=success&access_token=ignored")).toBe("/settings?section=credits&credit_checkout=success");
  expect(nativeAppRoute("filey://app/portal/1234567890abcdef")).toBe("/portal/1234567890abcdef");
  expect(nativeAppRoute("https://app.gofiley.com/#/reset-password?email=mark%40example.com&token_hash=proof&access_token=untrusted")).toBe("/reset-password?token_hash=proof&email=mark%40example.com");
  for (const link of ["javascript:alert(1)", "filey://evil/settings", "filey://user@app/settings", "filey://app:8080/settings", "https://app.gofiley.com.evil.test/#/settings", "filey://app/invoicing/delete-all", "filey://app/" + "x".repeat(8192)])
    expect(nativeAppRoute(link)).toBeNull();
});

test("native status text follows app theme and resume without blocking lifecycle or affecting web", async () => {
  native.style.mockRejectedValueOnce(new Error("Status bar unavailable"));
  native.overlay.mockRejectedValueOnce(new Error("Overlay setting unavailable"));
  const stop = await startNativeLifecycle();
  expect(native.style).toHaveBeenLastCalledWith({ style: "LIGHT" });
  expect(native.overlay).toHaveBeenCalledExactlyOnceWith({ overlay: false });
  expect(native.background).toHaveBeenLastCalledWith({ color: "#ffffff" });
  applyTheme("dark");
  expect(native.style).toHaveBeenLastCalledWith({ style: "DARK" });
  expect(native.background).toHaveBeenLastCalledWith({ color: "#0a0a0a" });
  const stateChanged = native.appListener.mock.calls.find(([name]) => name === "appStateChange")?.[1];
  stateChanged({ isActive: true });
  expect(native.style).toHaveBeenCalledTimes(3);
  expect(native.style).toHaveBeenLastCalledWith({ style: "DARK" });
  applyTheme("light");
  expect(native.style).toHaveBeenLastCalledWith({ style: "LIGHT" });
  expect(native.background).toHaveBeenLastCalledWith({ color: "#ffffff" });
  stop();
  applyTheme("dark");
  expect(native.style).toHaveBeenCalledTimes(4);
  expect(native.remove).toHaveBeenCalledTimes(4);
  native.enabled = false;
  await startNativeLifecycle();
  applyTheme("light");
  expect(native.style).toHaveBeenCalledTimes(4);
  expect(native.appListener).toHaveBeenCalledTimes(3);
  native.enabled = true;
  native.platform = "ios";
  const stopIos = await startNativeLifecycle();
  expect(native.style).toHaveBeenLastCalledWith({ style: "LIGHT" });
  expect(native.overlay).toHaveBeenCalledTimes(1);
  expect(native.background).toHaveBeenCalledTimes(4);
  stopIos();
});
