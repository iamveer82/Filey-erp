import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sendWhatsAppWithComputer } from "../whatsappComputerSend";
import { aiChat } from "../ai";
import { saveDocumentPdf } from "../documentMessage";
import { desktopBrowserCommand } from "../desktopBrowser";
import { enableComputerUse, disableComputerUse, runComputerUse } from "../computerUse";

const state = vi.hoisted(() => ({ scope: "local:org:user", picker: false, frame: 0, allowed: true, mode: "run", active: false, supported: true }));
vi.mock("../ai", () => ({ aiChat: vi.fn(), aiReady: () => true, getAiConfig: () => ({ model: "local-vision" }) }));
vi.mock("../agentStorage", () => ({
  AGENT_STORAGE_EVENT: "filey:agent-storage",
  requireAgentStorageScope: (expected: string) => { if (expected !== state.scope) throw new Error("Workspace changed"); return state.scope; },
}));
vi.mock("../agentMode", () => ({ gateFor: () => state.mode }));
vi.mock("../capabilities", () => ({ isToolAllowed: () => state.allowed }));
vi.mock("../computerUse", () => ({
  computerUseSupported: () => state.supported,
  getComputerUseState: () => ({ enabled: false, busy: false }),
  computerUseSessionActive: () => state.active,
  enableComputerUse: vi.fn(async () => { state.active = true; return 17; }),
  disableComputerUse: vi.fn(async () => { state.active = false; }),
  subscribeComputerUse: () => () => {},
  runComputerUse: vi.fn(),
}));
vi.mock("../desktopBrowser", () => ({ desktopBrowserCommand: vi.fn() }));
vi.mock("../documentMessage", () => ({
  internationalPhone: (value: string) => {
    const phone = value.replace(/[\s().-]/g, "");
    if (!/^\+[1-9]\d{6,14}$/.test(phone)) throw new Error("Invalid international phone");
    return phone;
  },
  saveDocumentPdf: vi.fn(),
}));

const file = new File(["%PDF-sample"], "INV-12.pdf", { type: "application/pdf" });
const input = { file, phone: "+971501234567", text: "Your invoice INV-12\n\nThank you.", expectedScope: "local:org:user" };
const path = "C:/Exports/INV-12.pdf";
const tab = { id: "filey-browser-test", window_id: "42", url: "https://web.whatsapp.com/send?phone=971501234567", loading: false, title: "WhatsApp", canGoBack: false, canGoForward: false };
const success = () => [
  { action: "click", screen: "chat", control: "attachments", observed_phone: "+971 50 123 4567", x: 10, y: 10 },
  { action: "click", screen: "chat", control: "document", x: 80, y: 90 },
  { action: "select_file", screen: "file_picker", x: 20, y: 20 },
  { action: "open_file", screen: "file_picker", observed_path: path },
  { action: "caption", screen: "attachment_preview", observed_filename: file.name, x: 30, y: 30 },
  { action: "send", screen: "attachment_preview", observed_filename: file.name, observed_caption: input.text, x: 400, y: 500 },
  { action: "finish", screen: "chat", observed_filename: file.name, observed_caption: input.text, message_state: "sent" },
];
function replies(steps: unknown[]) {
  vi.mocked(aiChat).mockImplementation(async () => JSON.stringify(steps.shift() ?? { action: "takeover", screen: "unknown" }));
}
async function run(overrides: Partial<Parameters<typeof sendWhatsAppWithComputer>[0]> = {}) {
  const pending = sendWhatsAppWithComputer({ ...input, ...overrides });
  await vi.runAllTimersAsync();
  return pending;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  Object.assign(state, { scope: input.expectedScope, picker: false, frame: 0, allowed: true, mode: "run", active: false, supported: true });
  vi.mocked(enableComputerUse).mockImplementation(async () => { state.active = true; return 17; });
  vi.mocked(disableComputerUse).mockImplementation(async () => { state.active = false; });
  vi.mocked(saveDocumentPdf).mockResolvedValue({ name: file.name, path });
  vi.mocked(desktopBrowserCommand).mockImplementation(async () => ({ tab, tabs: [tab] }));
  vi.mocked(runComputerUse).mockImplementation(async args => {
    if (args.action === "list_windows") return { windows: [{ window_id: "42" }, ...(state.picker ? [{ window_id: "84", root_owner_id: "42", window_class: "#32770" }] : []), { window_id: "999", root_owner_id: "999", window_class: "#32770" }] };
    if (args.action === "screenshot") return {
      window_id: args.window_id, snapshot_id: `frame-${++state.frame}`, width: 1000, height: 800,
      image: { mediaType: "image/png", dataBase64: "iVBORw0KGgoAAA==" },
    };
    if (args.action === "click" && args.x === 80) state.picker = true;
    if (args.action === "key" && args.key === "Enter") state.picker = false;
    return { ok: true };
  });
  replies(success());
});
afterEach(() => { vi.useRealTimers(); });

it("sends one exact PDF/caption through the scoped browser and verifies the outgoing bubble", async () => {
  const onProgress = vi.fn();
  expect(await run({ onProgress })).toMatchObject({ status: "sent", sendAttempted: true, path });
  expect(desktopBrowserCommand).toHaveBeenCalledWith({ action: "open", url: "https://web.whatsapp.com/send?phone=971501234567" }, expect.any(AbortSignal));
  expect(enableComputerUse).toHaveBeenCalledWith(null, "42");
  const actions = vi.mocked(runComputerUse).mock.calls.map(([args]) => args);
  expect(actions.filter(a => a.action === "type").map(a => a.text)).toEqual([path, input.text]);
  expect(actions.filter(a => a.action === "click" && a.x === 400)).toHaveLength(1);
  expect(actions.filter(a => a.action === "screenshot").every(a => ["42", "84"].includes(String(a.window_id)))).toBe(true);
  expect(new Set(actions.filter(a => ["click", "type", "key"].includes(String(a.action))).map(a => a.snapshot_id)).size)
    .toBe(actions.filter(a => ["click", "type", "key"].includes(String(a.action))).length);
  expect(disableComputerUse).toHaveBeenCalledWith(17);
  expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ sendAttempted: true }));
});

it.each(["wrong number", "unverified number", "wrong path", "wrong PDF", "wrong caption", "premature success"])("stops %s before sending", async fault => {
  const steps: Record<string, unknown>[] = success();
  if (fault === "wrong number") steps[0].observed_phone = "+971500000000";
  if (fault === "unverified number") delete steps[0].observed_phone;
  if (fault === "wrong path") steps[3].observed_path = "C:/Other/INV-12.pdf";
  if (fault === "wrong PDF") steps[4].observed_filename = "Another-customer.pdf";
  if (fault === "wrong caption") steps[5].observed_caption = "Pay another account";
  if (fault === "premature success") steps.splice(0, steps.length, steps[6]);
  replies(steps);
  expect(await run()).toMatchObject({ status: "needs_user", sendAttempted: false });
  expect(vi.mocked(runComputerUse).mock.calls.some(([a]) => a.action === "click" && a.x === 400)).toBe(false);
  expect(disableComputerUse).toHaveBeenCalledWith(17);
});

it("stops at login and revokes computer access without treating the draft as sent", async () => {
  replies([{ action: "takeover", screen: "login" }]);
  expect(await run()).toMatchObject({ status: "needs_user", sendAttempted: false, message: expect.stringMatching(/Sign in to WhatsApp/) });
  expect(runComputerUse).not.toHaveBeenCalledWith(expect.objectContaining({ action: "click" }), expect.anything(), expect.anything());
  expect(disableComputerUse).toHaveBeenCalledWith(17);
});

it("never retries after an uncertain Send click", async () => {
  const original = vi.mocked(runComputerUse).getMockImplementation()!;
  vi.mocked(runComputerUse).mockImplementation(async (...args) => {
    if (args[0].action === "click" && args[0].x === 400) throw new Error("Native acknowledgment lost");
    return original(...args);
  });
  expect(await run()).toMatchObject({ status: "unknown", sendAttempted: true });
  expect(vi.mocked(runComputerUse).mock.calls.filter(([a]) => a.action === "click" && a.x === 400)).toHaveLength(1);
});

it("rejects another action after Send even when the model asks for it", async () => {
  const steps = success();
  steps[6] = steps[5];
  replies(steps);
  expect(await run()).toMatchObject({ status: "unknown", sendAttempted: true });
  expect(vi.mocked(runComputerUse).mock.calls.filter(([a]) => a.action === "click" && a.x === 400)).toHaveLength(1);
});

it("cancels on workspace change before using a late AI decision", async () => {
  vi.mocked(aiChat).mockImplementation(async () => {
    state.scope = "cloud:other:user";
    window.dispatchEvent(new Event("filey:agent-storage"));
    return JSON.stringify(success()[0]);
  });
  expect(await run()).toMatchObject({ status: "stopped", sendAttempted: false });
  expect(vi.mocked(runComputerUse).mock.calls.some(([a]) => a.action === "click")).toBe(false);
});

it("stops on request and releases the native grant while a model call is pending", async () => {
  const controller = new AbortController();
  vi.mocked(aiChat).mockImplementation(async (_messages, options) => {
    controller.abort();
    options!.signal!.throwIfAborted();
    return "";
  });
  expect(await run({ signal: controller.signal })).toMatchObject({ status: "stopped", sendAttempted: false });
  expect(disableComputerUse).toHaveBeenCalledWith(17);
});

it("does not save a PDF or start a browser when computer access is disabled", async () => {
  state.allowed = false;
  expect(await run()).toMatchObject({ status: "needs_user", sendAttempted: false });
  expect(saveDocumentPdf).not.toHaveBeenCalled();
  expect(desktopBrowserCommand).not.toHaveBeenCalled();
});

it("does not capture or act on a browser redirected away from WhatsApp", async () => {
  vi.mocked(desktopBrowserCommand).mockImplementation(async args => ({
    tab, tabs: [{ ...tab, url: args.action === "list" ? "https://example.org/" : tab.url }],
  }));
  expect(await run()).toMatchObject({ status: "needs_user", sendAttempted: false });
  expect(runComputerUse).not.toHaveBeenCalled();
});
