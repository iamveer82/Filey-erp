import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prepareWhatsAppDocument, openMessageDraft } from "../documentMessage";
import { deliverFile } from "../agentFiles";
import { desktopBrowserCommand } from "../desktopBrowser";

const identity = vi.hoisted(() => ({ scope: "local:org:user" }));
vi.mock("../api", () => ({ billing: {} }));
vi.mock("../agentFiles", () => ({ deliverFile: vi.fn() }));
vi.mock("../desktopBrowser", () => ({ desktopBrowserSupported: () => true, desktopBrowserCommand: vi.fn() }));
vi.mock("../agentStorage", () => ({
  requireAgentStorageScope: (expected?: string) => {
    if (!identity.scope || (expected && expected !== identity.scope)) throw new Error("Your workspace changed.");
    return identity.scope;
  },
}));

function pdf(content = "%PDF-invoice") {
  const file = new File([content], "Invoice-123.pdf", { type: "application/pdf" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode(content).buffer });
  return file;
}
const input = () => ({ file: pdf(), phone: "+971 50 123 4567", text: "Invoice #123\nA & B — thank you.", expectedScope: identity.scope });

beforeEach(() => {
  identity.scope = "local:org:user";
  vi.mocked(deliverFile).mockResolvedValue({ name: "Invoice-123.pdf", path: "C:/Exports/Invoice-123.pdf" });
  vi.mocked(desktopBrowserCommand).mockResolvedValue({ tabs: [], tab: { id: "tab-1", title: "WhatsApp", url: "https://web.whatsapp.com/", loading: true, window_id: "42", canGoBack: false, canGoForward: false, blockedPopupUrl: null, warning: null } });
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
});
afterEach(() => {
  vi.clearAllMocks(); vi.unstubAllGlobals();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

it("saves the original PDF and exact draft in Filey's browser without sending", async () => {
  const draftInput = input();
  const result = await prepareWhatsAppDocument(draftInput);
  expect(result).toMatchObject({ status: "draft", sent: false, draftOpened: true, attachmentRequired: true, filename: "Invoice-123.pdf", path: "C:/Exports/Invoice-123.pdf", phone: "+971501234567", text: draftInput.text, surface: "filey_browser", tabId: "tab-1", windowId: "42" });
  expect(deliverFile).toHaveBeenCalledTimes(1);
  expect(deliverFile).toHaveBeenCalledWith(expect.objectContaining({ name: "Invoice-123.pdf" }));
  expect(Array.from(vi.mocked(deliverFile).mock.calls[0][0].bytes)).toEqual(Array.from(new TextEncoder().encode("%PDF-invoice")));
  expect(desktopBrowserCommand).toHaveBeenCalledExactlyOnceWith({ action: "open", url: `https://web.whatsapp.com/send?phone=971501234567&text=${encodeURIComponent(draftInput.text)}` }, undefined);
});

it("rejects malformed recipients and non-PDF exports before any handoff", async () => {
  await expect(prepareWhatsAppDocument({ ...input(), phone: "+971abc12345" })).rejects.toThrow("country code");
  await expect(prepareWhatsAppDocument({ ...input(), file: pdf("<html>error</html>") })).rejects.toThrow("not a valid PDF");
  expect(deliverFile).not.toHaveBeenCalled();
  expect(desktopBrowserCommand).not.toHaveBeenCalled();
});

it("does not open a draft after save cancellation", async () => {
  vi.mocked(deliverFile).mockResolvedValue({ name: "Invoice-123.pdf" });
  await expect(prepareWhatsAppDocument(input())).rejects.toThrow("save cancelled");
  expect(desktopBrowserCommand).not.toHaveBeenCalled();
});

it("stops before opening when saving outlives its account or cancellation", async () => {
  const controller = new AbortController();
  vi.mocked(deliverFile).mockImplementationOnce(async () => {
    identity.scope = "cloud:another-org:user";
    return { name: "Invoice-123.pdf", path: "C:/Exports/Invoice-123.pdf" };
  });
  await expect(prepareWhatsAppDocument(input())).rejects.toThrow("workspace changed");
  expect(desktopBrowserCommand).not.toHaveBeenCalled();
  vi.mocked(deliverFile).mockImplementationOnce(async () => {
    controller.abort();
    return { name: "Invoice-123.pdf", path: "C:/Exports/Invoice-123.pdf" };
  });
  await expect(prepareWhatsAppDocument({ ...input(), signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(desktopBrowserCommand).not.toHaveBeenCalled();
});

it("keeps the saved path and honestly reports a browser-open failure", async () => {
  vi.mocked(desktopBrowserCommand).mockRejectedValueOnce(new Error("Browser unavailable"));
  expect(await prepareWhatsAppDocument(input())).toMatchObject({ sent: false, status: "draft", draftOpened: false, path: "C:/Exports/Invoice-123.pdf", error: "Browser unavailable" });
});

it("reports a blocked browser popup instead of claiming the draft opened", async () => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  await expect(openMessageDraft("whatsapp", "+971501234567", "Exact text", { expectedScope: identity.scope })).rejects.toThrow("blocked WhatsApp");
  expect(open).toHaveBeenCalledExactlyOnceWith("about:blank", "_blank");
  open.mockRestore();
});
