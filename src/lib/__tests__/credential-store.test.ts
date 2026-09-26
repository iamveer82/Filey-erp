import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getCacheScope, setCacheOrg } from "../api";
import { flushCredentials, readCredential, saveCredential, quarantineLegacyCredentials, hasCredential } from "../credentialStore";
import { getAiConfig, getAiRequestConfig, setAiConfig } from "../ai";
import { generateImage, setImageConfig } from "../aiImage";
import { saveSecret, secretSubstitutions } from "../secretStore";

const vault = vi.hoisted(() => new Map<string,string>());
const native = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: native }));
beforeEach(() => {
  localStorage.clear(); vault.clear(); vi.clearAllMocks();
  setCacheOrg(null); setCacheOrg("org-a","user-a");
  Object.defineProperty(window,"__TAURI_INTERNALS__",{value:{},configurable:true});
  native.mockImplementation(async (command, args) => {
    const key = `${args.scope}:${args.name}`;
    if (command === "credential_write") { if (args.value) vault.set(key,args.value); else vault.delete(key); return; }
    if (command === "credential_read") return vault.get(key) ?? null;
    if (command === "credential_quarantine") { vault.set(`legacy:${args.name}`, args.value); return; }
    throw new Error(`Unexpected command: ${command}`);
  });
});
afterEach(async () => {
  await flushCredentials().catch(() => {});
  Reflect.deleteProperty(window,"__TAURI_INTERNALS__");
  setCacheOrg(null); vi.unstubAllGlobals();
});

it("separates accounts and organizations, survives reload, and writes no plaintext to settings", async () => {
  setAiConfig({provider:"openai",baseUrl:"https://one.example/v1",model:"model",apiKey:"fixture-key-a"});
  await saveSecret("test","fixture-agent-key");
  await flushCredentials();
  expect(JSON.stringify(localStorage)).not.toContain("fixture-key");
  expect(JSON.stringify(localStorage)).not.toContain("fixture-agent-key");
  setCacheOrg("org-a","user-b");
  expect(getAiConfig().apiKey).toBe("");
  expect(await readCredential("agent:test")).toBeNull();
  setCacheOrg("org-b","user-a");
  expect(await readCredential("agent:test")).toBeNull();
  setCacheOrg("org-a","user-a");
  expect((await getAiRequestConfig()).apiKey).toBe("fixture-key-a");
  setAiConfig({model:"new-model"}); await flushCredentials();
  expect((await getAiRequestConfig()).apiKey).toBe("fixture-key-a");
});

it("rejects reads that finish after an account switch and surfaces OS save failure", async () => {
  native.mockImplementationOnce(() => new Promise(resolve => {
    setCacheOrg("org-a","user-b"); resolve("wrong-account-value");
  }));
  await expect(readCredential("agent:test")).rejects.toThrow("same workspace");
  native.mockRejectedValueOnce(new Error("Secure store locked"));
  await expect(saveCredential("failure-test", "value")).rejects.toThrow("locked");
  await expect(readCredential("failure-test")).rejects.toThrow("locked");
  await saveCredential("failure-test", null);
});

it("does not flush settings captured for a different signed-in account", () => {
  const scope = getCacheScope()!;
  setCacheOrg("org-a","user-b");
  expect(() => setAiConfig({ apiKey:"old-draft" },scope)).toThrow("workspace changed");
  expect(vault.size).toBe(0);
});

it("does not send a chat key to a different image origin", async () => {
  setAiConfig({provider:"openai",baseUrl:"https://chat.example/v1",apiKey:"fixture-chat-key"});
  setImageConfig({baseUrl:"https://image.example/v1"});
  await flushCredentials();
  await expect(generateImage("A folder")).rejects.toThrow(/key/i);
  expect(native.mock.calls.some(([cmd])=>cmd === "ai_proxy")).toBe(false);
});

it("resolves secret references privately and redacts echoed values and encoded forms", async () => {
  await saveSecret("token","fixture/+key");
  const request = await secretSubstitutions(["Bearer {{secret:token}}"]);
  expect(request.fill("Bearer {{secret:token}}")).toEqual({text:"Bearer fixture/+key",used:["token"],missing:[]});
  expect(request.redact('echo: fixture/+key; fixture%2F%2Bkey')).toBe("echo: [REDACTED]; [REDACTED]");
});

it("quarantines unowned legacy credentials instead of claiming them for the current user", async () => {
  localStorage.setItem("filey.ai.config",JSON.stringify({apiKey:"legacy-fixture",model:"old"}));
  localStorage.setItem("filey.secret.portal","legacy-password");
  await quarantineLegacyCredentials();
  expect(localStorage.getItem("filey.ai.config")).toBe('{"model":"old"}');
  expect(localStorage.getItem("filey.secret.portal")).toBeNull();
  expect([...vault.keys()]).toEqual(["legacy:filey.ai.config","legacy:filey.secret.portal"]);
});

it("keeps browser keys only for the current session and clears them on sign-out", async () => {
  Reflect.deleteProperty(window,"__TAURI_INTERNALS__");
  await saveCredential("agent:test","browser-fixture");
  expect(await readCredential("agent:test")).toBe("browser-fixture");
  expect(JSON.stringify(localStorage)).not.toContain("browser-fixture");
  setCacheOrg(null); setCacheOrg("org-a","user-a");
  expect(await readCredential("agent:test")).toBeNull();
});

it("does not advertise a failed vault write or let it block a different provider", async () => {
  native.mockRejectedValueOnce(new Error("Secure store locked"));
  await expect(saveCredential("failed-provider", "fixture-unsaved")).rejects.toThrow("locked");
  expect(hasCredential("failed-provider")).toBe(false);
  await saveCredential("working-provider", "fixture-saved");
  await expect(flushCredentials("working-provider")).resolves.toBeUndefined();
  expect(await readCredential("working-provider")).toBe("fixture-saved");
  await saveCredential("failed-provider", null);
});
