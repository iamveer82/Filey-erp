import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { enableComputerUse, disableComputerUse, getComputerUseState, runComputerUse } from "../computerUse";

const identity = vi.hoisted(() => ({ scope: "local:company:user:owner" as string | null }));
vi.mock("../agentStorage", () => ({ agentStorageScope: () => identity.scope, AGENT_STORAGE_EVENT: "filey:agent-storage" }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  identity.scope = "local:company:user:owner";
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "computer_start") return { sessionToken: "private-native-token", expiresAt: Date.now() + 60_000 };
    return { ok: true };
  });
});
afterEach(async () => {
  await disableComputerUse();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("requires an explicit session and keeps its token outside public state and tool results", async () => {
  await expect(runComputerUse({ action: "list_windows" })).rejects.toThrow("Enable it");
  expect(invoke).not.toHaveBeenCalled();
  await enableComputerUse();
  expect(getComputerUseState()).toEqual({ enabled: true, expiresAt: expect.any(Number), busy: false });
  expect(await runComputerUse({ action: "list_windows" })).toEqual({ ok: true });
  expect(invoke).toHaveBeenLastCalledWith("computer_command", { sessionToken: "private-native-token", request: { action: "list_windows" } });
});

it("rejects unsupported actions/coordinates/shortcuts and never passes arbitrary code to the native helper", async () => {
  await enableComputerUse();
  for (const request of [
    { action: "evaluate", code: "anything" },
    { action: "click", snapshot_id: "frame", x: -1, y: 1 },
    { action: "key", snapshot_id: "frame", key: "Win+R" },
    { action: "scroll", snapshot_id: "frame", x: 5, y: 5, delta: 200 },
  ]) await expect(runComputerUse(request)).rejects.toThrow();
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "computer_command")).toHaveLength(0);
  await runComputerUse({ action: "click", snapshot_id: "fresh-frame", x: 10, y: 20, code: "ignored", cwd: "ignored" });
  expect(invoke).toHaveBeenLastCalledWith("computer_command", { sessionToken: "private-native-token", request: { action: "click", snapshot_id: "fresh-frame", x: 10, y: 20, button: "left", double_click: false } });
});

it("revokes native access on workspace changes and prevents the next action", async () => {
  await enableComputerUse();
  identity.scope = "cloud:another:user:person";
  window.dispatchEvent(new Event("filey:agent-storage"));
  expect(getComputerUseState().enabled).toBe(false);
  expect(invoke).toHaveBeenLastCalledWith("computer_stop", { sessionToken: "private-native-token" });
  await expect(runComputerUse({ action: "list_windows" })).rejects.toThrow("off or expired");
});

it("stops an in-flight action on Abort without accepting its late result", async () => {
  await enableComputerUse();
  let complete!: (result: unknown) => void;
  vi.mocked(invoke).mockImplementation((command) => command === "computer_command"
    ? new Promise((resolve) => { complete = resolve; }) : Promise.resolve(undefined));
  const controller = new AbortController();
  const pending = runComputerUse({ action: "list_windows" }, controller.signal);
  controller.abort();
  expect(getComputerUseState().enabled).toBe(false);
  expect(invoke).toHaveBeenLastCalledWith("computer_stop", { sessionToken: "private-native-token" });
  complete({ windows: [] });
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});

it("expires grants automatically and refuses malformed native screenshot payloads", async () => {
  vi.useFakeTimers();
  await enableComputerUse(60);
  vi.mocked(invoke).mockResolvedValueOnce({ image: { mediaType: "image/png", dataBase64: "not-png" } });
  await expect(runComputerUse({ action: "screenshot", window_id: "123" })).rejects.toThrow("captured image");
  await vi.advanceTimersByTimeAsync(60_001);
  expect(getComputerUseState().enabled).toBe(false);
  expect(invoke).toHaveBeenLastCalledWith("computer_stop", { sessionToken: "private-native-token" });
});

it("revokes the grant when the native helper reports Escape was pressed", async () => {
  await enableComputerUse();
  vi.mocked(invoke).mockRejectedValueOnce("Computer action failed: Computer action stopped by Escape.");
  await expect(runComputerUse({ action: "list_windows" })).rejects.toMatchObject({ name: "AbortError" });
  expect(getComputerUseState().enabled).toBe(false);
  expect(invoke).toHaveBeenLastCalledWith("computer_stop", { sessionToken: "private-native-token" });
});

it("binds a task to its browser and prevents an old task from using or revoking a replacement grant", async () => {
  const previous = await enableComputerUse(300, "42");
  expect(invoke).toHaveBeenCalledWith("computer_start", { durationSeconds: 300, windowId: "42" });
  const replacement = await enableComputerUse();
  vi.mocked(invoke).mockClear();
  await expect(runComputerUse({ action: "list_windows" }, undefined, previous)).rejects.toMatchObject({ name: "AbortError" });
  await disableComputerUse(previous);
  expect(invoke).not.toHaveBeenCalled();
  await runComputerUse({ action: "list_windows" }, undefined, replacement);
  expect(invoke).toHaveBeenCalledOnce();
});
