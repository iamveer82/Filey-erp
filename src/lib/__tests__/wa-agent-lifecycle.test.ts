import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  scope: "local:org:user:owner" as string | null,
  message: (_m: { id: string; from: string; text: string }) => {},
  voice: (_m: { id: string; from: string; b64: string }) => {},
}));
const mocks = vi.hoisted(() => ({
  agent: vi.fn(),
  reply: vi.fn(),
  log: vi.fn(),
  transcribe: vi.fn(),
}));
vi.mock("../agentStorage", () => ({
  agentStorageScope: () => state.scope,
  AGENT_STORAGE_EVENT: "test:scope",
}));
vi.mock("../ai", () => ({
  aiAgent: mocks.agent,
  aiReady: () => true,
  buildSystemPrompt: (s: string) => s,
  getPersona: () => ({}),
}));
vi.mock("../aiMemory", () => ({ memoryDigest: () => "" }));
vi.mock("../agentSkills", () => ({ skillsIndex: () => "" }));
vi.mock("../aiContext", () => ({ buildAiContext: async () => "" }));
vi.mock("../api", () => ({ billing: { getCompany: async () => null } }));
vi.mock("../waLog", () => ({ waLogAdd: mocks.log }));
vi.mock("../log", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../voice", () => ({
  sttAvailable: () => true,
  transcribeAudio: mocks.transcribe,
  ttsAvailable: () => false,
}));
vi.mock("../waBridge", () => ({
  hasDesktop: true,
  bridgeState: async () => ({ state: "connected", me: "971500000001@s.whatsapp.net" }),
  getBridgeConfig: () => ({ ownerNumber: "" }),
  replyWa: mocks.reply,
  sendWaFile: vi.fn(),
  onWaMessage: (callback: typeof state.message) => {
    state.message = callback;
  },
  onWaVoice: (callback: typeof state.voice) => {
    state.voice = callback;
  },
}));

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  state.scope = "local:org:user:owner";
  mocks.agent.mockResolvedValue("Done");
  mocks.reply.mockResolvedValue(undefined);
  const { startWaAgent } = await import("../waAgent");
  startWaAgent();
});
afterEach(() => vi.useRealTimers());

const send = (id: string, text: string) =>
  state.message({ id, from: "971500000001", text });
const answered = (id: string) =>
  vi.waitFor(() => expect(mocks.reply).toHaveBeenCalledWith(id, expect.any(String)));

it("silences stranger voice notes before calling a transcription provider", async () => {
  state.voice({ id: "stranger", from: "971599999999", b64: "YQ==" });
  await answered("stranger");
  expect(mocks.reply).toHaveBeenCalledWith("stranger", "");
  expect(mocks.transcribe).not.toHaveBeenCalled();
  expect(mocks.agent).not.toHaveBeenCalled();
});

it("requires a signed-in workspace and isolates history when the account changes", async () => {
  send("first", "private first account context");
  await answered("first");
  state.scope = null;
  send("signed-out", "show invoices");
  await answered("signed-out");
  expect(mocks.agent).toHaveBeenCalledTimes(1);
  state.scope = "local:other-org:user:other";
  send("other", "hello");
  await answered("other");
  expect(JSON.stringify(mocks.agent.mock.calls[1][0])).not.toContain(
    "private first account context"
  );
});

it("consumes approval for exactly one matching call", async () => {
  mocks.agent.mockImplementationOnce(async (_messages, opts) => {
    expect(opts.confirm("email_invoice", { id: 5 })).toBe(false);
    return "Approve invoice 5?";
  });
  send("proposal", "email invoice 5");
  await answered("proposal");
  mocks.agent.mockImplementationOnce(async (_messages, opts) => {
    expect(opts.confirm("email_invoice", { id: 5 })).toBe(true);
    expect(opts.confirm("email_invoice", { id: 5 })).toBe(false);
    expect(opts.confirm("email_invoice", { id: 9 })).toBe(false);
    return "Approved action finished";
  });
  send("approval", "YES");
  await answered("approval");
});

it("does not record delivery success when the bridge rejects a reply", async () => {
  mocks.reply.mockRejectedValueOnce(new Error("disconnected"));
  send("failed", "hello");
  await answered("failed");
  expect(mocks.log.mock.calls.some(([entry]) => entry.dir === "out")).toBe(false);
});

it("aborts a timed-out model run so later tools cannot keep executing", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  mocks.agent.mockImplementationOnce((_messages, opts) => {
    signal = opts.signal;
    return new Promise(() => {});
  });
  send("slow", "long task");
  await vi.waitFor(() => expect(signal).toBeDefined());
  await vi.advanceTimersByTimeAsync(200_001);
  expect(signal?.aborted).toBe(true);
  expect(mocks.reply).toHaveBeenCalledWith(
    "slow",
    expect.stringContaining("stopped the agent")
  );
});
