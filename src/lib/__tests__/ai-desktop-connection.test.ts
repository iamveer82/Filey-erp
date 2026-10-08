import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  return vi.fn();
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: native }));
import { setCacheOrg } from "../api";
import { aiChat, aiFetch, setAiConfig } from "../ai";

beforeEach(() => native.mockReset());
afterEach(() => vi.restoreAllMocks());
afterAll(() => { Reflect.deleteProperty(window, "__TAURI_INTERNALS__"); vi.unstubAllGlobals(); });

it.each([true, false])("does not dispatch a desktop request stopped before native transport is ready (already stopped: %s)", async alreadyStopped => {
  native.mockResolvedValue({ status: 200, body: "{}" });
  const controller = new AbortController();
  if (alreadyStopped) controller.abort();
  const pending = aiFetch("https://provider.example/v1/chat/completions", {
    method: "POST", body: "{}", signal: controller.signal,
  });
  if (!alreadyStopped) controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(native).not.toHaveBeenCalled();
});

it.each([true, false])("releases its desktop abort listener after the request settles (success: %s)", async succeeds => {
  if (succeeds) native.mockResolvedValue({ status: 200, body: "{}" });
  else native.mockImplementation(async command => {
    if (command === "ai_proxy") throw new Error("Connection lost");
    return null;
  });
  const controller = new AbortController();
  const added = vi.spyOn(controller.signal, "addEventListener");
  const removed = vi.spyOn(controller.signal, "removeEventListener");
  await aiFetch("https://provider.example/v1/chat/completions", {
    method: "POST", body: "{}", signal: controller.signal,
  }).catch(() => undefined);
  expect(native).toHaveBeenCalledTimes(1);
  const listeners = added.mock.calls.filter(([name]) => name === "abort");
  expect(listeners).toHaveLength(1);
  expect(removed).toHaveBeenCalledWith("abort", listeners[0][1]);
});

it("saves to the native vault and authenticates through the desktop proxy without browser fetch", async () => {
  const vault = new Map<string, string>();
  native.mockImplementation(async (command, args) => {
    if (!args) return null;
    const name = `${args.scope}:${args.name}`;
    if (command === "credential_write") { vault.set(name, args.value); return; }
    if (command === "credential_read") return vault.get(name) ?? null;
    if (command === "ai_proxy") return { status: 200, body: JSON.stringify({ content: [{ type: "text", text: "ok" }] }) };
    throw new Error(`Unexpected native command: ${command}`);
  });
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  localStorage.clear(); setCacheOrg("desktop-test", "qa-user");
  setAiConfig({ provider: "anthropic", baseUrl: "https://api.anthropic.com/v1", model: "claude-opus-5", apiKey: "fixture-desktop-key" });
  expect(await aiChat([{ role: "user", text: "Hello" }])).toBe("ok");
  expect(native).toHaveBeenCalledWith("ai_proxy", expect.objectContaining({
    method: "POST", url: "https://api.anthropic.com/v1/messages",
    headers: expect.objectContaining({ "x-api-key": "fixture-desktop-key" }),
  }));
  expect(fetch).not.toHaveBeenCalled();
  expect(JSON.stringify(localStorage)).not.toContain("fixture-desktop-key");
});
