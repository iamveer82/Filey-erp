import { afterEach, beforeEach, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ scope: "local:org:user:owner" as string | null, pending: null as null | ((updates: unknown[]) => void), token: false }));
const mocks = vi.hoisted(() => ({ native: vi.fn(), save: vi.fn(), access: vi.fn(), run: vi.fn(), delivered: vi.fn(), stopComputer: vi.fn(), clear: vi.fn(), clearConversation: vi.fn(), lock: vi.fn(), ready: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.native }));
vi.mock("../api", () => ({ getCacheScope: () => env.scope }));
vi.mock("../agentStorage", () => ({
  agentStorageScope: () => env.scope, AGENT_STORAGE_EVENT: "test:telegram-scope",
  readAgentStorage: (key: string) => localStorage.getItem(`${key}:${env.scope}`),
  writeAgentStorage: (key: string, value: string | null, expected: string) => {
    if (expected !== env.scope) throw new Error("Workspace changed");
    if (value === null) localStorage.removeItem(`${key}:${env.scope}`); else localStorage.setItem(`${key}:${env.scope}`, value);
  },
}));
vi.mock("../credentialStore", () => ({ hasCredential: () => env.token, saveCredential: mocks.save, readCredential: async () => env.token ? token : null }));
vi.mock("../moduleAccess", () => ({ requireModuleAccess: mocks.access }));
vi.mock("../remoteAgentTurn", () => ({ runRemoteAgentTurn: mocks.run, clearRemoteAgentTurns: mocks.clear, clearRemoteAgentConversation: mocks.clearConversation }));
vi.mock("../agentComputer", () => ({ stopAgentComputer: mocks.stopComputer }));
vi.mock("../ai", () => ({ aiReady: mocks.ready }));

import { connectTelegram, disconnectTelegram, telegramState, startTelegramAgent } from "../telegramAgent";
const token = "123456789:synthetic-token-not-a-live-key";
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const message = (id: number, text: string, owner = 42, type = "private") => ({ update_id: id, message: { message_id: id, date: Math.floor(Date.now() / 1000), text, from: { id: owner }, chat: { id: owner, type } } });
async function feed(updates: unknown[]) { await flush(); expect(env.pending).not.toBeNull(); const deliver = env.pending!; env.pending = null; deliver(updates); await flush(); }
async function pair() { await connectTelegram(token); await feed([message(10, `PAIR ${telegramState().pairCode}`)]); expect(telegramState().state).toBe("connected"); }

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); env.scope = "local:org:user:owner"; env.pending = null; env.token = false;
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  mocks.save.mockImplementation(async (_name, value) => { env.token = !!value; });
  mocks.access.mockResolvedValue(undefined); mocks.stopComputer.mockResolvedValue(undefined);
  mocks.ready.mockReturnValue(true);
  mocks.run.mockResolvedValue({ text: "Done", files: [], delivered: mocks.delivered });
  mocks.lock.mockImplementation(async (_name, _opts, run) => run({ name: "test-lock" }));
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: mocks.lock } });
  mocks.native.mockImplementation(async (command, { method, payload }) => {
    expect(command).toBe("telegram_request");
    if (method === "getMe") return { id: 123456789, username: "filey_demo_bot", is_bot: true };
    if (method === "getWebhookInfo") return { url: "" };
    if (method === "getUpdates") return payload.offset === -1 ? [] : new Promise(resolve => { env.pending = resolve; });
    if (method === "sendMessage" || method === "sendDocument") return { message_id: 999 };
    if (method === "sendChatAction") return true;
    if (method === "downloadFile") return { b64: btoa("synthetic file") };
    throw new Error("Unexpected request");
  });
  startTelegramAgent();
});
afterEach(async () => { env.scope = "local:org:user:owner"; await disconnectTelegram(true); await flush(); delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__; });

it("pairs only a fresh exact code from a private human account; tokens never enter polling arguments", async () => {
  await connectTelegram(token);
  const code = telegramState().pairCode;
  await feed([message(1, `PAIR ${code}`, 77, "group"), message(2, "PAIR wrong", 77)]);
  expect(telegramState().state).toBe("pairing"); expect(mocks.run).not.toHaveBeenCalled();
  await feed([message(3, `PAIR ${code}`)]);
  expect(telegramState()).toMatchObject({ state: "connected", ownerId: "42" });
  expect(JSON.stringify(mocks.native.mock.calls)).not.toContain(token);
  expect(mocks.native.mock.calls.filter(([,args]) => args.method !== "getMe").every(([,args]) => args.expectedBotId === "123456789")).toBe(true);
  expect(localStorage.getItem("filey.telegram_agent:local:org:user:owner")).not.toContain(token);
});

it("ignores strangers, groups, stale tasks and provider redeliveries", async () => {
  await pair();
  const old = message(14, "old task"); old.message.date -= 3600;
  await feed([message(11, "private records", 43), message(12, "private records", 42, "group"), old, message(15, "List invoices")]);
  expect(mocks.run).toHaveBeenCalledTimes(1);
  await feed([message(15, "List invoices")]); expect(mocks.run).toHaveBeenCalledTimes(1);
});

it("returns only turn-produced files and commits approval/history after confirmed final delivery", async () => {
  await pair();
  mocks.run.mockResolvedValueOnce({ text: "Invoice ready", files: [{ name: "invoice.pdf", path: "generated-path" }], delivered: mocks.delivered });
  await feed([message(11, "Export invoice")]);
  expect(mocks.native.mock.calls.filter(([, args]) => args.method === "sendDocument")[0][1].payload).toEqual({ chat_id: "42", path: "generated-path", filename: "invoice.pdf" });
  expect(mocks.delivered).toHaveBeenCalledWith(expect.stringContaining("accepted by Telegram"));
  expect(mocks.run.mock.calls[0][0]).toMatchObject({ channel: "telegram", conversationId: "42", scope: env.scope });
});

it("does not retry ambiguous replies or commit unseen approvals", async () => {
  await pair();
  mocks.native.mockImplementation(async (_cmd, { method }) => {
    if (method === "getUpdates") return new Promise(resolve => { env.pending = resolve; });
    if (method === "sendChatAction") return true;
    throw new Error("delivery lost");
  });
  await feed([message(11, "Send invoice")]);
  expect(mocks.delivered).not.toHaveBeenCalled();
  expect(mocks.run).toHaveBeenCalledTimes(1);
  expect(telegramState().error).toMatch(/not confirmed/);
});

it("never reports an unconfirmed document response as accepted or retries its send", async () => {
  await pair();
  mocks.run.mockResolvedValueOnce({ text: "Invoice ready", files: [{ name: "invoice.pdf", path: "generated-path" }], delivered: mocks.delivered });
  const original = mocks.native.getMockImplementation()!;
  mocks.native.mockImplementation((command, args) => args.method === "sendDocument" ? Promise.resolve({}) : original(command, args));
  await feed([message(11, "Export invoice")]);
  expect(mocks.native.mock.calls.filter(([, args]) => args.method === "sendDocument")).toHaveLength(1);
  expect(mocks.delivered).toHaveBeenCalledWith(expect.stringContaining("delivery not confirmed"));
  expect(mocks.delivered.mock.calls[0][0]).not.toContain("accepted by Telegram");
});

it("stops an active task immediately and closes its isolated agent browser", async () => {
  await pair();
  mocks.run.mockImplementationOnce(({ signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true })));
  await feed([message(11, "Long task")]);
  const signal = mocks.run.mock.calls[0][0].signal;
  await feed([message(12, "/stop")]);
  expect(signal.aborted).toBe(true);
  expect(mocks.stopComputer).toHaveBeenCalledWith("telegram:42");
  expect(mocks.delivered).not.toHaveBeenCalled();
});

it("invalidates running work and polling on workspace change without replying from the new account", async () => {
  await pair();
  mocks.run.mockImplementationOnce(({ signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true })));
  await feed([message(11, "Pending task")]);
  const signal = mocks.run.mock.calls[0][0].signal;
  const sends = mocks.native.mock.calls.filter(([, args]) => args.method === "sendMessage").length;
  env.scope = "cloud:other-org:user:other"; window.dispatchEvent(new Event("test:telegram-scope")); await flush();
  expect(signal.aborted).toBe(true); expect(telegramState().state).toBe("disconnected");
  expect(mocks.native.mock.calls.filter(([, args]) => args.method === "sendMessage")).toHaveLength(sends);
});

it("does not take over an existing webhook", async () => {
  mocks.native.mockImplementation(async (_cmd, { method }) => method === "getMe" ? { id: 123456789, username: "filey_demo_bot", is_bot: true } : { url: "https://example.org/webhook" });
  await expect(connectTelegram(token)).rejects.toThrow("another service");
  expect(mocks.native.mock.calls.some(([, args]) => args.method === "deleteWebhook")).toBe(false);
});

it("refuses duplicate Filey window ownership", async () => {
  mocks.lock.mockImplementationOnce(async (_name, _opts, run) => run(null));
  await expect(connectTelegram(token)).rejects.toThrow("another Filey window"); await flush();
  expect(telegramState().error).toMatch(/another Filey window/);
  expect(mocks.run).not.toHaveBeenCalled();
  expect(mocks.native.mock.calls.some(([, args]) => args.method === "getUpdates")).toBe(false);
  expect(localStorage.getItem("filey.telegram_agent:local:org:user:owner")).toBeNull();
});

it("explains missing AI configuration without running a task", async () => {
  await pair(); mocks.ready.mockReturnValue(false);
  await feed([message(11, "Export invoice"), message(12, "/status")]);
  expect(mocks.run).not.toHaveBeenCalled();
  expect(mocks.native.mock.calls.filter(([, args]) => args.method === "sendMessage" && /Connect a model/.test(args.payload.text))).toHaveLength(2);
});

it("expires unused pairing codes", async () => {
  await connectTelegram(token);
  const code = telegramState().pairCode;
  const now = Date.now(); const clock = vi.spyOn(Date, "now").mockReturnValue(now + 600_001);
  try { await feed([message(1, `PAIR ${code}`)]); expect(telegramState().error).toMatch(/expired/); expect(mocks.run).not.toHaveBeenCalled(); }
  finally { clock.mockRestore(); }
});

it("splits Unicode replies within Telegram's length limit and stops remaining parts after /stop", async () => {
  await pair();
  mocks.run.mockResolvedValueOnce({ text: "✦".repeat(8500), files: [], delivered: mocks.delivered });
  const original = mocks.native.getMockImplementation()!;
  let firstReply: (() => void) | undefined;
  mocks.native.mockImplementation((command, args) => {
    if (args.method === "sendMessage" && args.payload.text.length === 4000) return new Promise(resolve => { firstReply = () => resolve({ message_id: 999 }); });
    return original(command, args);
  });
  await feed([message(11, "Long answer")]);
  await feed([message(12, "/stop")]); firstReply?.(); await flush();
  expect(mocks.native.mock.calls.filter(([, args]) => args.method === "sendMessage" && args.payload.text.length === 4000)).toHaveLength(1);
  expect(mocks.delivered).not.toHaveBeenCalled();
});

it("refuses the model when workspace integration permission cannot be verified", async () => {
  mocks.access.mockRejectedValueOnce(new Error("Role denied"));
  await expect(connectTelegram(token)).rejects.toThrow("Role denied");
  expect(mocks.native).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
});

it("passes a bounded downloaded document into the Filey tools without trusting its filename", async () => {
  await pair();
  const update = { ...message(11, "Extract text"), message: { ...message(11, "Extract text").message, document: { file_id: "provider-file", file_name: "../invoice.pdf", mime_type: "application/pdf", file_size: 14 } } };
  await feed([update]);
  expect(mocks.run.mock.calls[0][0].attachments[0]).toMatchObject({ name: "invoice.pdf", type: "application/pdf" });
});
