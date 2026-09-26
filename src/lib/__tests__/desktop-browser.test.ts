vi.mock("../moduleAccess", () => ({ requireModuleAccess: vi.fn(async () => {}) }));
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { closeDesktopBrowserTabs, desktopBrowserCommand, getBrowserPanelState, setBrowserPanelOpen, layoutDesktopBrowser, registerBrowserViewportSync, selectAgentBrowser, pauseAgentBrowser } from "../desktopBrowser";
import { agentComputerCommand, stopAgentComputer } from "../agentComputer";
import { disableComputerUse } from "../computerUse";
import { requireModuleAccess } from "../moduleAccess";

const identity = vi.hoisted(() => ({ scope: "local:org:user:one" as string | null, account: "org:user:one" as string | null }));
const features = vi.hoisted(() => ({ computers: true }));
vi.mock("../capabilities", () => ({ isToolAllowed: () => features.computers }));
vi.mock("../agentStorage", () => ({ agentStorageScope: () => identity.scope, AGENT_STORAGE_EVENT: "filey:agent-storage" }));
vi.mock("../api", () => ({ getCacheScope: () => identity.account }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
type NativeArgs = { profile: string; request: { action: string } };
const nativeCalls = () => vi.mocked(invoke).mock.calls.map(([, args]) => args as NativeArgs);
const lastCall = () => nativeCalls()[nativeCalls().length - 1];

it("docks opened tabs, preserves them on collapse, and rejects invalid viewport bounds", async () => {
  const tab = { id: "filey-browser-00000000-0000-0000-0000-000000000000", title: "Example", url: "https://example.com/", loading: false, window_id: "123", canGoBack: false, canGoForward: false };
  vi.mocked(invoke).mockResolvedValue({ tabs: [tab], tab });
  await desktopBrowserCommand({ action: "open", url: tab.url });
  expect(getBrowserPanelState()).toMatchObject({ open: true, activeId: tab.id });
  setBrowserPanelOpen(false);
  expect(getBrowserPanelState().tabs).toHaveLength(1);
  await layoutDesktopBrowser(null, tab.id);
  expect(invoke).toHaveBeenLastCalledWith("desktop_browser_layout", { profile: expect.any(String), bounds: null, tabId: tab.id });
  await expect(layoutDesktopBrowser({ x: -1, y: 0, width: 300, height: 500 }, tab.id)).rejects.toThrow("Invalid browser");
});
it("finishes an in-flight show before applying collapse", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const show = layoutDesktopBrowser({ x: 500, y: 80, width: 300, height: 400 }, "tab");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  const hide = layoutDesktopBrowser(null, null);
  await Promise.resolve();
  expect(invoke).toHaveBeenCalledTimes(1);
  finish(undefined);
  await Promise.all([show, hide]);
  expect(invoke).toHaveBeenLastCalledWith("desktop_browser_layout", { profile: expect.any(String), bounds: null, tabId: null });
});

it("reports a viewport failure to the caller instead of claiming the browser opened", async () => {
  const unregister = registerBrowserViewportSync(async () => { throw new Error("Native view unavailable"); });
  try {
    await expect(desktopBrowserCommand({ action: "open", url: "https://example.com/" })).rejects.toThrow("Native view unavailable");
  } finally { unregister(); }
});

beforeEach(() => {
  vi.clearAllMocks();
  features.computers = true;
  identity.scope = "local:org:user:one";
  identity.account = "org:user:one";
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  vi.mocked(invoke).mockResolvedValue({ tabs: [] });
});

it("blocks optional agent computers before opt-in and closes their workspace when turned off", async () => {
  features.computers = false;
  await expect(agentComputerCommand({ action: "open", url: "https://example.com/" }, "optional-agent")).rejects.toThrow("Agent computers are off");
  await expect(selectAgentBrowser("optional-agent")).rejects.toThrow("Agent computers are off");
  expect(invoke).not.toHaveBeenCalled();
  features.computers = true;
  await agentComputerCommand({ action: "list" }, "optional-agent");
  expect(getBrowserPanelState().agentId).toBe("optional-agent");
  features.computers = false;
  window.dispatchEvent(new Event("filey:agent-storage"));
  await vi.waitFor(() => expect(getBrowserPanelState().agentId).toBeNull());
  expect(nativeCalls().some(args => args.request?.action === "close_all")).toBe(true);
  await expect(agentComputerCommand({ action: "screenshot" }, "optional-agent")).rejects.toThrow("Agent computers are off");
});
afterEach(async () => {
  await disableComputerUse();
  await closeDesktopBrowserTabs();
  await selectAgentBrowser(null);
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

it("keeps conversation profiles stable and prevents queued navigation after takeover", async () => {
  await desktopBrowserCommand({ action: "list" }, undefined, "chat-a");
  const first = lastCall().profile;
  await desktopBrowserCommand({ action: "list" }, undefined, "chat-b");
  expect(lastCall().profile).not.toBe(first);
  await desktopBrowserCommand({ action: "list" }, undefined, "chat-a");
  expect(lastCall().profile).toBe(first);
  let release!: () => void;
  vi.mocked(requireModuleAccess).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const pending = desktopBrowserCommand({ action: "open", url: "https://example.com" }, undefined, "chat-a");
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  await pauseAgentBrowser(true);
  release();
  await rejected;
  expect(nativeCalls().some(call => call.request?.action === "open")).toBe(false);
});

it("binds agent input to its conversation, tab and native grant, and revokes on stop", async () => {
  const tab = { id: "filey-browser-00000000-0000-0000-0000-000000000000", title: "Example", url: "https://example.com/", loading: false, window_id: "123", canGoBack: false, canGoForward: false };
  vi.mocked(invoke).mockImplementation(async (command, raw) => {
    const args = raw as { request?: { action: string } };
    if (command === "desktop_browser_command") return { tabs: args.request?.action === "close_all" ? [] : [tab], tab };
    if (command === "computer_start") return { sessionToken: "private-token", expiresAt: null };
    if (args.request?.action === "screenshot") return { snapshot_id: "fresh", image: { mediaType: "image/png", dataBase64: "iVBORw0KGgo-test" } };
    return { ok: true };
  });
  const controller = new AbortController();
  await agentComputerCommand({ action: "open", url: tab.url }, "chat-a", controller.signal);
  await expect(agentComputerCommand({ action: "click", x: 1, y: 1, snapshot_id: "fresh" }, "chat-a")).rejects.toThrow("fresh screenshot");
  await expect(agentComputerCommand({ action: "screenshot" }, "chat-b")).rejects.toThrow("workspace first");
  await agentComputerCommand({ action: "screenshot" }, "chat-a", controller.signal);
  expect(invoke).toHaveBeenCalledWith("computer_start", { durationSeconds: null, windowId: "123", browserTab: tab.id });
  await agentComputerCommand({ action: "click", x: 1, y: 1, snapshot_id: "fresh" }, "chat-a", controller.signal);
  expect(invoke).toHaveBeenLastCalledWith("computer_command", { sessionToken: "private-token", request: { action: "click", x: 1, y: 1, snapshot_id: "fresh", button: "left", double_click: false } });
  await pauseAgentBrowser(true);
  await expect(agentComputerCommand({ action: "type", text: "stale", snapshot_id: "fresh" }, "chat-a")).rejects.toThrow("user has control");
  await pauseAgentBrowser(false);
  await expect(agentComputerCommand({ action: "type", text: "stale", snapshot_id: "fresh" }, "chat-a")).rejects.toThrow("fresh screenshot");
  controller.abort();
  await vi.waitFor(() => expect(getBrowserPanelState().tabs).toHaveLength(0));
  expect(invoke).toHaveBeenCalledWith("computer_stop", { sessionToken: "private-token" });
  await stopAgentComputer("chat-a");
});

it("allows explicit web navigation and strips arbitrary script and profile arguments", async () => {
  await desktopBrowserCommand({ action: "open", url: "https://web.whatsapp.com/", code: "do not run", profile: "other" });
  expect(invoke).toHaveBeenCalledWith("desktop_browser_command", {
    profile: expect.stringMatching(/^[a-f0-9]{64}$/), request: { action: "open", url: "https://web.whatsapp.com/" },
  });
  for (const url of ["javascript:alert(1)", "file:///C:/secret", "https://tauri.localhost/", "http://localhost:1420/", "https://a:b@example.com/", "http://example.com/"])
    await expect(desktopBrowserCommand({ action: "open", url })).rejects.toThrow();
  await expect(desktopBrowserCommand({ action: "evaluate", code: "anything" })).rejects.toThrow("Unsupported");
  expect(invoke).toHaveBeenCalledTimes(1);
});

it("keeps account/company profiles separate while retaining the profile across storage modes", async () => {
  await desktopBrowserCommand({ action: "list" });
  const localProfile = lastCall().profile;
  identity.scope = "cloud:org:user:one";
  window.dispatchEvent(new Event("filey:agent-storage"));
  await desktopBrowserCommand({ action: "list" });
  expect(lastCall().profile).toBe(localProfile);
  expect(nativeCalls().some((args) => args.request.action === "close_all")).toBe(true);
  identity.account = "other:user:two";
  identity.scope = "cloud:other:user:two";
  window.dispatchEvent(new Event("filey:agent-storage"));
  await desktopBrowserCommand({ action: "list" });
  expect(lastCall().profile).not.toBe(localProfile);
});

it("rejects anonymous/browser-only callers and invalid tab targets", async () => {
  identity.account = null; identity.scope = null;
  await expect(desktopBrowserCommand({ action: "list" })).rejects.toThrow("Sign in");
  identity.account = "org:user:one"; identity.scope = "local:org:user:one";
  await expect(desktopBrowserCommand({ action: "close", tab_id: "main" })).rejects.toThrow("Choose");
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  await expect(desktopBrowserCommand({ action: "list" })).rejects.toThrow("Windows desktop");
  expect(invoke).not.toHaveBeenCalled();
});

it("closes a late-opened tab after cancellation instead of returning another workspace's result", async () => {
  let complete!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation((_, args) => (args as NativeArgs)?.request.action === "open"
    ? new Promise((resolve) => { complete = resolve; }) : Promise.resolve({ tabs: [] }));
  const controller = new AbortController();
  const pending = desktopBrowserCommand({ action: "open", url: "https://example.com/" }, controller.signal);
  await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
  controller.abort();
  expect(lastCall().request.action).toBe("close_all");
  complete({ tabs: [] });
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(nativeCalls().some((args) => args.request.action === "close_all")).toBe(true);
});

it("preserves long multilingual invoice captions and rejects URLs beyond the encoded limit", async () => {
  const url = `https://web.whatsapp.com/send?text=${encodeURIComponent("漢".repeat(4000))}`;
  await desktopBrowserCommand({ action: "open", url });
  expect(invoke).toHaveBeenLastCalledWith("desktop_browser_command", { profile: expect.any(String), request: { action: "open", url } });
  await expect(desktopBrowserCommand({ action: "open", url: `https://example.com/?text=${"漢".repeat(10_000)}` })).rejects.toThrow("encoded URL");
});

it("cancels polling without closing the user's browser windows", async () => {
  await desktopBrowserCommand({ action: "open", url: "https://example.com/" });
  let complete!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  const controller = new AbortController();
  const pending = desktopBrowserCommand({ action: "list" }, controller.signal);
  await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
  controller.abort();
  complete({ tabs: [] });
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(nativeCalls().some((args) => args.request.action === "close_all")).toBe(false);
  await desktopBrowserCommand({ action: "list" });
  expect(lastCall().request.action).toBe("list");
});
