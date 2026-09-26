import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  scope: "local:org:user:owner" as string | null,
  message: (_m: { id: string; bridgeSession: string; from: string; text: string; chatJid?: string; attachment?: { name: string; mimetype: string; b64: string } }) => {},
  voice: (_m: { id: string; bridgeSession: string; from: string; b64: string }) => {},
  bridge: (_state: { state: string }) => {},
}));
const mocks = vi.hoisted(() => ({
  agent: vi.fn(),
  reply: vi.fn(),
  log: vi.fn(),
  transcribe: vi.fn(),
  sendFile: vi.fn(),
  setFiles: vi.fn(),
  endTurn: vi.fn(),
  clearProgress: vi.fn(),
  bridgeState: vi.fn(),
  ttsAvailable: vi.fn(),
  textToSpeech: vi.fn(),
}));
vi.mock("../agentStorage", () => ({
  agentStorageScope: () => state.scope,
  AGENT_STORAGE_EVENT: "test:scope",
}));
vi.mock("../agentRunState", () => ({ clearAgentProgress: mocks.clearProgress }));
vi.mock("../ai", () => ({
  aiAgent: mocks.agent,
  aiReady: () => true,
  buildSystemPrompt: (s: string) => s,
  getPersona: () => ({}),
}));
vi.mock("../aiMemory", () => ({ memoryDigest: () => "" }));
vi.mock("../agentSkills", () => ({ skillsIndex: () => "" }));
vi.mock("../aiTools", () => ({ approvalArgs: (_name: string, args: unknown) => args, setTurnFiles: mocks.setFiles, endTurn: mocks.endTurn }));
vi.mock("../aiContext", () => ({ buildAiContext: async () => "" }));
vi.mock("../api", () => ({ billing: { getCompany: async () => null } }));
vi.mock("../waLog", () => ({ waLogAdd: mocks.log }));
vi.mock("../agentSessions", () => ({ whatsappContext: () => [] }));
vi.mock("../agentComputer", () => ({ stopAgentComputer: vi.fn(async () => {}) }));
vi.mock("../log", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../voice", () => ({
  sttAvailable: () => true,
  transcribeAudio: mocks.transcribe,
  ttsAvailable: mocks.ttsAvailable,
  textToSpeech: mocks.textToSpeech,
}));
vi.mock("../waBridge", () => ({
  hasDesktop: true,
  bridgeState: mocks.bridgeState,
  getBridgeConfig: () => ({ ownerNumber: "" }),
  replyWa: mocks.reply,
  sendWaFile: mocks.sendFile,
  onBridgeState: (callback: typeof state.bridge) => { state.bridge = callback; },
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
  mocks.sendFile.mockResolvedValue("accepted-file-id");
  mocks.bridgeState.mockReset().mockResolvedValue({ state: "connected", me: "971500000001@s.whatsapp.net", sessionId: "session-one" });
  mocks.ttsAvailable.mockReturnValue(false);
  mocks.endTurn.mockReset().mockReturnValue([]);
  const { startWaAgent } = await import("../waAgent");
  startWaAgent();
});
afterEach(() => vi.useRealTimers());

const send = (id: string, text: string) =>
  state.message({ id, bridgeSession: "session-one", from: "971500000001", text });
const answered = (id: string) =>
  vi.waitFor(() => expect(mocks.reply).toHaveBeenCalledWith(id, expect.any(String), expect.any(String)));

it("answers a simple greeting without waiting for a model or scanning business records", async () => {
  send("greeting", "Hyy");
  await answered("greeting");
  expect(mocks.reply).toHaveBeenCalledWith("greeting", expect.stringContaining("Send me a task"), "session-one");
  expect(mocks.agent).not.toHaveBeenCalled();
});

it("cancels active and queued work when the WhatsApp connection closes", async () => {
  let signal: AbortSignal | undefined;
  mocks.agent.mockImplementationOnce((_messages, opts) => {
    signal = opts.signal;
    return new Promise(() => {});
  });
  send("running", "Work on my file");
  await vi.waitFor(() => expect(signal).toBeDefined());
  send("queued", "Then send it");
  await new Promise(resolve => setTimeout(resolve, 10));
  state.bridge({ state: "stopped" });
  await answered("running");
  await answered("queued");
  expect(signal?.aborted).toBe(true);
  expect(mocks.agent).toHaveBeenCalledOnce();
  expect(mocks.sendFile).not.toHaveBeenCalled();
});

it("attaches an owner's document to a unique turn and returns its generated PDF to the original LID chat", async () => {
  const attachment = { name: "input.pdf", mimetype: "application/pdf", b64: btoa("%PDF-fixture") };
  mocks.endTurn.mockReturnValueOnce([{ name: "invoice.pdf", path: "C:/Exports/invoice.pdf" }]);
  state.message({ id: "pdf", bridgeSession: "session-one", from: "971500000001", chatJid: "900000000001@lid", text: "Compress this PDF", attachment });
  await answered("pdf");
  const turn = mocks.agent.mock.calls[0][1].turnId;
  expect(turn).toMatch(/^whatsapp-/);
  expect(mocks.setFiles).toHaveBeenCalledWith(turn, [expect.objectContaining({ name: "input.pdf", type: "application/pdf", size: 12 })], undefined);
  expect(mocks.sendFile).toHaveBeenCalledExactlyOnceWith("900000000001@lid", { path: "C:/Exports/invoice.pdf", filename: "invoice.pdf" }, "session-one");
  expect(mocks.reply).toHaveBeenCalledWith("pdf", expect.stringContaining("invoice.pdf: accepted by WhatsApp"), "session-one");
  expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ document: expect.objectContaining({ outcome: "accepted", key: "accepted-file-id" }) }), state.scope);
  expect(mocks.agent.mock.calls[0][1].signal.aborted).toBe(true);
});

it("reports an uncertain file send without retrying or logging a success", async () => {
  mocks.endTurn.mockReturnValueOnce([{ name: "report.pdf", path: "C:/Exports/report.pdf" }]);
  mocks.sendFile.mockRejectedValueOnce(new Error("Provider timeout"));
  send("file-failure", "Export my report");
  await answered("file-failure");
  expect(mocks.sendFile).toHaveBeenCalledOnce();
  expect(mocks.reply).toHaveBeenCalledWith("file-failure", expect.stringContaining("delivery was not confirmed"), "session-one");
  expect(mocks.log.mock.calls.some(([entry]) => entry.document?.outcome === "accepted")).toBe(false);
});

it("retains the original attachment for approval and refuses an approval carrying a replacement", async () => {
  const attachment = { name: "input.pdf", mimetype: "application/pdf", b64: btoa("%PDF-fixture") };
  mocks.agent.mockImplementationOnce(async (_messages, opts) => {
    opts.confirm("run_file_tool", { tool_id: "compress" });
    return "Approve compression?";
  });
  state.message({ id: "attachment-proposal", bridgeSession: "session-one", from: "971500000001", text: "Compress", attachment });
  await answered("attachment-proposal");
  mocks.agent.mockImplementationOnce(async (_messages, opts) => {
    expect(opts.confirm("run_file_tool", { tool_id: "compress" })).toBe(true);
    opts.confirm("send_whatsapp_file", { file: "result.pdf", to: "971500000009" });
    return "Approve sending?";
  });
  send("attachment-yes", "YES");
  await answered("attachment-yes");
  expect(mocks.setFiles.mock.calls[1][1][0]).toBe(mocks.setFiles.mock.calls[0][1][0]);
  mocks.agent.mockImplementationOnce(async (_messages, opts) => {
    expect(opts.confirm("send_whatsapp_file", { file: "result.pdf", to: "971500000009" })).toBe(false);
    return "Needs approval again";
  });
  state.message({ id: "replacement", bridgeSession: "session-one", from: "971500000001", text: "YES", attachment });
  await answered("replacement");
});

it("never forwards produced files after the account changes", async () => {
  mocks.agent.mockImplementationOnce(async () => { state.scope = "cloud:another:owner"; return "Done"; });
  mocks.endTurn.mockReturnValueOnce([{ name: "private.pdf", path: "C:/Exports/private.pdf" }]);
  send("changed", "Make a PDF");
  await answered("changed");
  expect(mocks.sendFile).not.toHaveBeenCalled();
  expect(mocks.reply).toHaveBeenCalledWith("changed", "", "session-one");
});

it("does not send the same output twice and keeps file references for an exact follow-up approval", async () => {
  const file = { name: "invoice.pdf", path: "C:/Exports/invoice.pdf", whatsappRecipients: ["971500000001@s.whatsapp.net"] };
  mocks.endTurn.mockReturnValueOnce([file]);
  mocks.agent.mockImplementationOnce(async (_messages, opts) => { opts.confirm("send_whatsapp_file", { file: "invoice.pdf", to: "971500000009" }); return "Approve the customer copy?"; });
  send("file-proposal", "Also send the invoice to my customer");
  await answered("file-proposal");
  expect(mocks.sendFile).not.toHaveBeenCalled();
  send("file-yes", "YES");
  await answered("file-yes");
  expect(mocks.setFiles.mock.calls[1][2]).toEqual([file]);
});

it("handles owner controls without model calls and stops active work before the next request", async () => {
  send("status", "/status");
  await answered("status");
  expect(mocks.agent).not.toHaveBeenCalled();
  let signal!: AbortSignal;
  mocks.agent.mockImplementationOnce((_messages, opts) => {
    signal = opts.signal;
    return new Promise(() => {});
  });
  send("long", "Prepare a report");
  await vi.waitFor(() => expect(signal).toBeDefined());
  send("stop", "/stop");
  await answered("stop");
  expect(signal.aborted).toBe(true);
  await answered("long");
  expect(mocks.reply).toHaveBeenCalledWith("long", "", "session-one");
  send("new", "/new");
  await answered("new");
  expect(mocks.clearProgress).toHaveBeenCalledWith("whatsapp:971500000001", state.scope);
  expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ sessionStart: true }), state.scope);
  send("next", "Hello again");
  await answered("next");
  expect(mocks.agent).toHaveBeenCalledTimes(2);
});

it("silences stranger voice notes before calling a transcription provider", async () => {
  state.voice({ id: "stranger", bridgeSession: "session-one", from: "971599999999", b64: "YQ==" });
  await answered("stranger");
  expect(mocks.reply).toHaveBeenCalledWith("stranger", "", "session-one");
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
  send("other", "Show my overdue invoices");
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
  expect(mocks.reply).toHaveBeenCalledWith("proposal", expect.stringContaining('"id": 5'), "session-one");
  mocks.agent.mockImplementationOnce(async (_messages, opts) => {
    expect(opts.confirm("email_invoice", { id: 5 })).toBe(true);
    expect(opts.confirm("email_invoice", { id: 5 })).toBe(false);
    expect(opts.confirm("email_invoice", { id: 9 })).toBe(false);
    return "Approved action finished";
  });
  send("approval", "YES");
  await answered("approval");
});

it("clears outstanding approval across sign-out and sign-in to the same workspace", async () => {
  mocks.agent.mockImplementationOnce(async (_messages, opts) => {
    opts.confirm("email_invoice", { id: 5 });
    return "Approve?";
  });
  send("proposal", "email invoice 5");
  await answered("proposal");
  state.scope = null;
  window.dispatchEvent(new Event("test:scope"));
  state.scope = "local:org:user:owner";
  window.dispatchEvent(new Event("test:scope"));
  mocks.agent.mockImplementationOnce(async (_messages, opts) => {
    expect(opts.confirm("email_invoice", { id: 5 })).toBe(false);
    return "Please approve again";
  });
  send("new-session", "YES");
  await answered("new-session");
});

it("expires waiting turns before they can perform delayed actions", async () => {
  vi.useFakeTimers();
  mocks.agent.mockImplementationOnce(() => new Promise(() => {}));
  send("slow-first", "long task");
  await vi.waitFor(() => expect(mocks.agent).toHaveBeenCalledTimes(1));
  send("waiting", "send invoice later");
  await vi.advanceTimersByTimeAsync(201_000);
  expect(mocks.agent).toHaveBeenCalledTimes(1);
  expect(mocks.reply).toHaveBeenCalledWith("waiting", expect.stringContaining("expired while waiting"), "session-one");
});

it("does not record delivery success when the bridge rejects a reply", async () => {
  mocks.reply.mockRejectedValueOnce(new Error("disconnected"));
  send("failed", "hello");
  await answered("failed");
  expect(mocks.log.mock.calls.some(([entry]) => entry.dir === "out")).toBe(false);
});

it("cannot approve a proposal whose delivery failed", async () => {
  mocks.reply.mockRejectedValueOnce(new Error("disconnected"));
  mocks.agent.mockImplementationOnce(async (_messages, opts) => {
    opts.confirm("email_invoice", { id: 5 });
    return "Approve?";
  });
  send("lost-proposal", "email invoice 5");
  await answered("lost-proposal");
  mocks.agent.mockImplementationOnce(async (_messages, opts) => {
    expect(opts.confirm("email_invoice", { id: 5 })).toBe(false);
    return "Approve again";
  });
  send("yes", "YES");
  await answered("yes");
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
    expect.stringContaining("stopped the agent"),
    "session-one"
  );
});

it("rejects requests from a prior native bridge session or a disconnected phone", async () => {
  state.message({ id: "old-session", bridgeSession: "session-old", from: "971500000001", text: "/new" });
  await answered("old-session");
  mocks.bridgeState.mockResolvedValueOnce({ state: "reconnecting", me: "971500000001@s.whatsapp.net", sessionId: "session-one" });
  send("disconnected", "List invoices");
  await answered("disconnected");
  expect(mocks.agent).not.toHaveBeenCalled();
  expect(mocks.clearProgress).not.toHaveBeenCalled();
  expect(mocks.reply).toHaveBeenCalledWith("old-session", "", "session-old");
  expect(mocks.reply).toHaveBeenCalledWith("disconnected", "", "session-one");
});

it("does not run a control whose owner lookup completed after stop", async () => {
  let finish!: (value: { state: string; me: string; sessionId: string }) => void;
  mocks.bridgeState.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  send("delayed-new", "/new");
  send("stop-now", "/stop");
  await answered("stop-now");
  finish({ state: "connected", me: "971500000001@s.whatsapp.net", sessionId: "session-one" });
  await answered("delayed-new");
  expect(mocks.clearProgress).not.toHaveBeenCalled();
  expect(mocks.reply).toHaveBeenCalledWith("delayed-new", "", "session-one");
});

it("does not read or log a task in a workspace changed during the second owner check", async () => {
  let finish!: (value: { state: string; me: string; sessionId: string }) => void;
  mocks.bridgeState.mockResolvedValueOnce({ state: "connected", me: "971500000001@s.whatsapp.net", sessionId: "session-one" });
  mocks.bridgeState.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  send("workspace-race", "Private task");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  state.scope = "cloud:other-org:user:other";
  finish({ state: "connected", me: "971500000001@s.whatsapp.net", sessionId: "session-one" });
  await answered("workspace-race");
  expect(mocks.agent).not.toHaveBeenCalled();
  expect(mocks.log).not.toHaveBeenCalled();
  expect(mocks.reply).toHaveBeenCalledWith("workspace-race", "", "session-one");
});

it("stop releases a hanging spoken reply so new tasks can proceed", async () => {
  mocks.transcribe.mockResolvedValueOnce("Hello");
  mocks.ttsAvailable.mockReturnValueOnce(true);
  mocks.textToSpeech.mockImplementationOnce(() => new Promise(() => {}));
  state.voice({ id: "speaking", bridgeSession: "session-one", from: "971500000001", b64: "YQ==" });
  await vi.waitFor(() => expect(mocks.textToSpeech).toHaveBeenCalledOnce());
  send("stop-speech", "/stop");
  await answered("stop-speech");
  send("after-speech", "Hello again");
  await answered("after-speech");
  expect(mocks.agent).toHaveBeenCalledTimes(2);
  expect(mocks.sendFile).not.toHaveBeenCalled();
});

it("does not forward raw provider failures or credentials to WhatsApp", async () => {
  mocks.agent.mockRejectedValueOnce(new Error("provider response: Authorization: Bearer secret-fixture; SQL SELECT private_data"));
  send("provider-error", "Prepare a summary");
  await answered("provider-error");
  expect(mocks.reply).toHaveBeenCalledWith("provider-error", expect.stringContaining("task could not finish"), "session-one");
  expect(JSON.stringify(mocks.reply.mock.calls)).not.toContain("secret-fixture");
});
