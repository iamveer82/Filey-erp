import { afterAll, expect, it, vi } from "vitest";

const native = vi.hoisted(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  return vi.fn();
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: native }));
import { setCacheOrg } from "../api";
import { aiChat, setAiConfig } from "../ai";

afterAll(() => { Reflect.deleteProperty(window, "__TAURI_INTERNALS__"); vi.unstubAllGlobals(); });

it("saves to the native vault and authenticates through the desktop proxy without browser fetch", async () => {
  const vault = new Map<string, string>();
  native.mockImplementation(async (command, args) => {
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
