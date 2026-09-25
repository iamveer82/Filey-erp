import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { billing, crm, setCacheOrg, type InvoiceDoc, type InvoiceDocSummary } from "../api";
import { approvalArgs, runTool, TOOLS, endTurn } from "../aiTools";
import { offeredTools } from "../agentHarness";
import { setAgentMode } from "../agentMode";
import { setCapabilityEnabled } from "../capabilities";
import { setDataMode } from "../dataMode";
import { reactToPdfBytes } from "../reactPdf";
import { deliverFile } from "../agentFiles";
import { desktopBrowserCommand, getBrowserPanelState } from "../desktopBrowser";
import { runComputerUse } from "../computerUse";
import { bridgeState, sendWaFile, sendWa } from "../waBridge";
import { waLogAdd } from "../waLog";
import { log } from "../log";
import * as zernio from "../zernio";
import { getCountryMarketData, getPublicHolidays, listHolidayCountries, searchCreativeAssets, WORK_SERVICES } from "../workServices";

vi.mock("../log", async original => ({ ...await original<typeof import("../log")>(), log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../reactPdf", () => ({ reactToPdfBytes: vi.fn() }));
vi.mock("../../components/InvoiceExportSheet", () => ({ default: () => null }));
vi.mock("../../components/StampSignatureSettings", () => ({ loadCompanyStampSig: async () => ({}), durableStampSig: (value: unknown) => value, EMPTY_STAMP_SIG: {} }));
vi.mock("../../components/BankDetails", () => ({ loadBankInfo: async () => ({}), EMPTY_BANK: {} }));
vi.mock("../agentFiles", () => ({ deliverFile: vi.fn() }));
vi.mock("../desktopBrowser", () => ({ desktopBrowserSupported: () => true, desktopBrowserCommand: vi.fn(), getBrowserPanelState: vi.fn(() => ({ paused: false })) }));
vi.mock("../computerUse", () => ({ runComputerUse: vi.fn(async () => ({ windows: [] })) }));
vi.mock("../waBridge", () => ({ hasDesktop: true, bridgeState: vi.fn(), sendWaFile: vi.fn(), sendWa: vi.fn() }));
vi.mock("../waLog", () => ({ waLogAdd: vi.fn() }));
vi.mock("../workServices", () => ({
  WORK_SERVICES: [{ id: "local-test", access: "local" }],
  getCountryMarketData: vi.fn(async () => ({ source: "market", countryCode: "AE" })),
  getPublicHolidays: vi.fn(async () => ({ source: "holidays", countryCode: "DE" })),
  listHolidayCountries: vi.fn(async () => [{ code: "DE", name: "Germany" }]),
  searchCreativeAssets: vi.fn(async () => ({ source: "assets", items: [] })),
}));

const PDF = new TextEncoder().encode("%PDF-1.7\nMock invoice bytes\n%%EOF");
const summary = (changes: Partial<InvoiceDocSummary> = {}): InvoiceDocSummary => ({
  id: 12, number: "INV-12", customer_name: "Acme", status: "draft", template: "minimal",
  total: 105, updated_at: "2026-09-08T00:00:00Z", ...changes,
});
const document = (changes: Partial<InvoiceDoc> = {}): InvoiceDoc => ({
  id: 12, number: "INV-12", customer_id: 7, customer_name: "Acme", status: "draft", template: "minimal",
  accent: "#111111", currency: "AED", seller_name: "Filey", tax_rate: 5, discount: 0,
  created_at: "2026-09-08T00:00:00Z", updated_at: "2026-09-08T00:00:00Z",
  items: [{ id: 1, description: "Service", qty: 1, unit_price: 100 }], ...changes,
});
const call = (name: string, args: Record<string, unknown> = {}, signal?: AbortSignal) =>
  runTool(name, args, () => true, true, undefined, signal);
const originalArrayBuffer = Object.getOwnPropertyDescriptor(File.prototype, "arrayBuffer");

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  setDataMode("local");
  setCacheOrg("connected-test-org", "connected-test-user");
  setAgentMode("auto");
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  // jsdom lacks File.arrayBuffer; read its actual Blob bytes through FileReader.
  Object.defineProperty(File.prototype, "arrayBuffer", { configurable: true, value: function (this: File) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  } });
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected network access in connected-work test"); }));
  vi.spyOn(billing, "listDocs").mockResolvedValue([summary()]);
  vi.spyOn(billing, "getDoc").mockResolvedValue(document());
  vi.spyOn(billing, "setStatus").mockResolvedValue();
  vi.spyOn(crm, "customers").mockResolvedValue([{ id: 7, name: "Acme", phone: "+971501234567" }] as never);
  vi.mocked(reactToPdfBytes).mockReset().mockResolvedValue({ name: "mock.pdf", bytes: PDF });
  vi.mocked(deliverFile).mockReset().mockImplementation(async (file) => ({ name: file.name, path: `C:/Exports/${file.name}` }));
  vi.mocked(desktopBrowserCommand).mockReset().mockResolvedValue({ tabs: [], tab: {
    id: "filey-browser-00000000-0000-0000-0000-000000000000", title: "WhatsApp", url: "https://web.whatsapp.com/",
    loading: true, window_id: "42", canGoBack: false, canGoForward: false,
  } });
  vi.mocked(bridgeState).mockReset().mockResolvedValue({ state: "connected" });
  vi.mocked(sendWaFile).mockReset().mockResolvedValue("provider-id");
  vi.mocked(sendWa).mockReset().mockResolvedValue("provider-id");
  vi.spyOn(zernio, "listAccounts").mockResolvedValue([{ id: "social-1", platform: "instagram" }]);
  vi.spyOn(zernio, "createPost").mockResolvedValue({ id: "post-1", status: "published" });
});
it("requires provider acceptance and prevents text delivery after a workspace switch", async () => {
  vi.mocked(sendWa).mockRejectedValueOnce(new Error("Timeout: check the chat before retrying"));
  expect(await call("send_whatsapp", { to: "971500000001", text: "Fixture" })).toMatchObject({ retry_safe: false });
  expect(waLogAdd).not.toHaveBeenCalled();
  vi.mocked(sendWa).mockClear();
  vi.mocked(bridgeState).mockImplementationOnce(async () => {
    setCacheOrg("changed-workspace", "changed-user");
    return { state: "connected" };
  });
  await expect(call("send_whatsapp", { to: "971500000001", text: "Fixture" })).rejects.toMatchObject({ name: "AbortError" });
  expect(sendWa).not.toHaveBeenCalled();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  if (originalArrayBuffer) Object.defineProperty(File.prototype, "arrayBuffer", originalArrayBuffer);
  else delete (File.prototype as unknown as Record<string, unknown>).arrayBuffer;
});

describe("invoice WhatsApp tools", () => {
  it("exports an invoice PDF into only its own turn without sending or changing the invoice", async () => {
    const result = await runTool("export_invoice_pdf", { invoice_number: "INV-12" }, () => true, true, "owner-pdf-turn");
    expect(result).toMatchObject({ ok: true, file: "INV-12.pdf" });
    expect(vi.mocked(deliverFile).mock.calls[0][0].name).toBe("INV-12.pdf");
    expect(Array.from(vi.mocked(deliverFile).mock.calls[0][0].bytes)).toEqual(Array.from(PDF));
    expect(endTurn("different-turn")).toEqual([]);
    expect(endTurn("owner-pdf-turn")).toEqual([{ name: "INV-12.pdf", path: "C:/Exports/INV-12.pdf" }]);
    expect(billing.setStatus).not.toHaveBeenCalled();
    expect(sendWaFile).not.toHaveBeenCalled();
  });
  it.each(["971abc12345", "++971501234567", "0501234567", "+0001234567"])("rejects malformed recipient %s before PDF export or sending", async (to) => {
    expect(await call("send_invoice_whatsapp", { invoice_number: "INV-12", to })).toMatchObject({ error: expect.stringMatching(/international phone number/) });
    expect(reactToPdfBytes).not.toHaveBeenCalled();
    expect(deliverFile).not.toHaveBeenCalled();
    expect(sendWaFile).not.toHaveBeenCalled();
  });

  it("loads the full document and resolves its customer ID before duplicate old names", async () => {
    vi.mocked(billing.listDocs).mockResolvedValue([summary({ customer_name: "Same Name" })]);
    vi.mocked(billing.getDoc).mockResolvedValue(document({ customer_id: 42, customer_name: "Same Name" }));
    vi.mocked(crm.customers).mockResolvedValue([
      { id: 7, name: "Same Name", phone: "+971500000007" },
      { id: 8, name: "Same Name", phone: "+971500000008" },
      { id: 42, name: "Renamed Customer", phone: "+971500000042" },
    ] as never);
    expect(await call("send_invoice_whatsapp", { invoice_number: "INV-12" })).toMatchObject({ status: "accepted", recipient: "+971500000042" });
    expect(billing.getDoc).toHaveBeenCalledExactlyOnceWith(12);
    expect(sendWaFile).toHaveBeenCalledExactlyOnceWith("971500000042@s.whatsapp.net", expect.objectContaining({ filename: "INV-12.pdf", mimetype: "application/pdf" }));
  });

  it("refuses an ambiguous customer name when the full document has no linked ID", async () => {
    vi.mocked(billing.getDoc).mockResolvedValue(document({ customer_id: undefined }));
    vi.mocked(crm.customers).mockResolvedValue([
      { id: 7, name: "Acme", phone: "+971500000007" },
      { id: 8, name: "Acme", phone: "+971500000008" },
    ] as never);
    expect(await call("prepare_invoice_whatsapp", { invoice_number: "INV-12" })).toMatchObject({ error: expect.stringMatching(/Several customers/) });
    expect(reactToPdfBytes).not.toHaveBeenCalled();
    expect(desktopBrowserCommand).not.toHaveBeenCalled();
    expect(sendWaFile).not.toHaveBeenCalled();
  });

  it("stops after rendering if the account changes before saving or sending", async () => {
    vi.mocked(reactToPdfBytes).mockImplementationOnce(async () => {
      setCacheOrg("another-org", "another-user");
      return { name: "mock.pdf", bytes: PDF };
    });
    expect(await call("send_invoice_whatsapp", { invoice_number: "INV-12" })).toMatchObject({ error: expect.stringMatching(/workspace changed/i) });
    expect(deliverFile).not.toHaveBeenCalled();
    expect(sendWaFile).not.toHaveBeenCalled();
    expect(billing.setStatus).not.toHaveBeenCalled();
  });

  it("keeps provider acceptance when the subsequent ledger update fails", async () => {
    vi.mocked(billing.setStatus).mockRejectedValueOnce(new Error("Ledger unavailable"));
    const result = await call("send_invoice_whatsapp", { invoice_number: "INV-12", message: "Reviewed caption" });
    expect(result).toMatchObject({ ok: true, status: "accepted", warning: expect.stringMatching(/accepted.*Ledger unavailable/) });
    expect(result).not.toHaveProperty("error");
    expect(sendWaFile).toHaveBeenCalledTimes(1);
    expect(billing.setStatus).toHaveBeenCalledExactlyOnceWith(12, "sent");
    expect(desktopBrowserCommand).not.toHaveBeenCalled();
  });

  it("keeps acceptance but avoids another workspace's ledger after the provider responds", async () => {
    vi.mocked(sendWaFile).mockImplementationOnce(async () => { setCacheOrg("another-org", "another-user"); return "provider-id"; });
    expect(await call("send_invoice_whatsapp", { invoice_number: "INV-12" })).toMatchObject({ ok: true, status: "accepted", warning: expect.stringMatching(/workspace changed/i) });
    expect(billing.setStatus).not.toHaveBeenCalled();
    expect(waLogAdd).not.toHaveBeenCalled();
  });

  it("marks an uncertain send unsafe to retry and never falls back to another transport", async () => {
    vi.mocked(sendWaFile).mockRejectedValueOnce(new Error("Timed out waiting for provider acceptance"));
    expect(await call("send_invoice_whatsapp", { invoice_number: "INV-12" })).toMatchObject({
      error: expect.stringMatching(/Timed out/), delivery: "unconfirmed", retry_safe: false,
    });
    expect(sendWaFile).toHaveBeenCalledTimes(1);
    expect(billing.setStatus).not.toHaveBeenCalled();
    expect(waLogAdd).not.toHaveBeenCalled();
    expect(desktopBrowserCommand).not.toHaveBeenCalled();
  });

  it("prepares an unsent draft with the actual PDF and exact reviewed caption", async () => {
    const message = "Invoice attached — شكراً\nPlease review A & B.";
    expect(await call("prepare_invoice_whatsapp", { invoice_number: "INV-12", to: "971501234567", message })).toMatchObject({
      status: "draft", sent: false, attachmentRequired: true, draftOpened: true,
      filename: "INV-12.pdf", path: "C:/Exports/INV-12.pdf", phone: "+971501234567", text: message, windowId: "42",
    });
    expect(Array.from(vi.mocked(deliverFile).mock.calls[0][0].bytes)).toEqual(Array.from(PDF));
    expect(desktopBrowserCommand).toHaveBeenCalledExactlyOnceWith({ action: "open", url: `https://web.whatsapp.com/send?phone=971501234567&text=${encodeURIComponent(message)}` }, undefined);
    expect(sendWaFile).not.toHaveBeenCalled();
    expect(billing.setStatus).not.toHaveBeenCalled();
  });

  it("exports slash-formatted invoice numbers safely without changing the printed number", async () => {
    vi.mocked(billing.listDocs).mockResolvedValue([summary({ number: "INV/2026/001" })]);
    vi.mocked(billing.getDoc).mockResolvedValue(document({ number: "INV/2026/001" }));
    expect(await call("prepare_invoice_whatsapp", { invoice_number: "id:12" })).toMatchObject({ filename: "INV_2026_001.pdf", draftOpened: true });
    const [sheet, filename] = vi.mocked(reactToPdfBytes).mock.calls[0];
    expect((sheet as ReactElement<{ form: InvoiceDoc }>).props.form.number).toBe("INV/2026/001");
    expect(filename).toBe("INV_2026_001");
    expect(billing.getDoc).toHaveBeenCalledTimes(1);
  });
});

describe("connected work discovery and permissions", () => {
  it("does not reacquire computer access after takeover while approval is open", async () => {
    const session = vi.fn(async () => 42);
    const approve = () => {
      vi.mocked(getBrowserPanelState).mockReturnValueOnce({ paused: true } as ReturnType<typeof getBrowserPanelState>);
      return true;
    };
    await expect(runTool("computer_use", { action: "list_windows" }, approve, true, "turn", undefined, session)).rejects.toMatchObject({ name: "AbortError" });
    expect(session).not.toHaveBeenCalled();
  });
  it("starts in-app computer access only after owner, capability, mode and approval checks", async () => {
    const session = vi.fn(async () => 42);
    const args = { action: "list_windows" };
    const run = (approve = true, owner = true) => runTool("computer_use", args, () => approve, owner, "test-turn", undefined, session);
    expect(await run(true, false)).toHaveProperty("error");
    setCapabilityEnabled("computer", false);
    expect(await run()).toHaveProperty("error");
    setCapabilityEnabled("computer", true);
    setAgentMode("plan");
    expect(await run()).toHaveProperty("error");
    setAgentMode("auto");
    expect(await run(false)).toHaveProperty("error");
    expect(session).not.toHaveBeenCalled();
    expect(await run()).toEqual({ windows: [] });
    expect(session).toHaveBeenCalledOnce();
    expect(runComputerUse).toHaveBeenCalledWith(args, undefined, 42);
    vi.mocked(runComputerUse).mockClear();
    expect(await runTool("computer_use", args, () => true, true)).toMatchObject({ error: expect.stringMatching(/Remote and scheduled tasks/) });
    expect(runComputerUse).not.toHaveBeenCalled();
  });
  const sensitive = ["prepare_invoice_whatsapp", "send_invoice_whatsapp", "workspace_browser"];
  const offered = (isOwner = true) => offeredTools({ isOwner }, new Set(["messaging", "web"])).map((tool) => tool.name);

  it("offers the new tools through their domains and keeps remote customers away from desktop actions", () => {
    expect(offered()).toEqual(expect.arrayContaining([...sensitive, "work_service"]));
    for (const name of sensitive) {
      expect(TOOLS.find((tool) => tool.name === name)).toMatchObject({ ownerOnly: true, sensitive: true });
      expect(offered(false)).not.toContain(name);
    }
    expect(offered(false)).toContain("work_service");
    setAgentMode("plan");
    for (const name of sensitive) expect(offered()).not.toContain(name);
    expect(offered()).toContain("work_service");
  });

  it("honours disabled capabilities for both execution and model discovery", async () => {
    setCapabilityEnabled("channels", false);
    setCapabilityEnabled("computer", false);
    setCapabilityEnabled("web", false);
    for (const name of [...sensitive, "work_service"]) {
      expect(offered()).not.toContain(name);
      expect(await call(name, { action: "list", invoice_number: "INV-12" })).toMatchObject({ error: expect.stringMatching(/turned off/) });
    }
    expect(billing.listDocs).not.toHaveBeenCalled();
    expect(desktopBrowserCommand).not.toHaveBeenCalled();
    expect(getCountryMarketData).not.toHaveBeenCalled();
  });

  it.each(sensitive)("requires the caller's approval for %s even in Auto mode", async (name) => {
    const confirm = vi.fn(() => false);
    expect(await runTool(name, { action: "list", invoice_number: "INV-12" }, confirm, true)).toMatchObject({ error: expect.stringMatching(/did not approve/) });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(billing.listDocs).not.toHaveBeenCalled();
    expect(desktopBrowserCommand).not.toHaveBeenCalled();
    expect(sendWaFile).not.toHaveBeenCalled();
  });

  it("forwards browser actions and cancellation to the guarded desktop adapter", async () => {
    const controller = new AbortController();
    const args = { action: "open", url: "https://example.com/" };
    expect(await call("workspace_browser", args, controller.signal)).toHaveProperty("tabs");
    expect(desktopBrowserCommand).toHaveBeenCalledExactlyOnceWith(args, controller.signal);
  });

  it("hides navigation URLs in diagnostics while keeping the exact approval preview", async () => {
    const args = { action: "open", url: "https://example.com/callback?access_token=private#code=secret" };
    await call("workspace_browser", args);
    expect(log.info).toHaveBeenCalledWith("agent", "workspace_browser running", { action: "open", url: "********" });
    expect(approvalArgs("workspace_browser", args)).toEqual(args);
    expect(desktopBrowserCommand).toHaveBeenCalledExactlyOnceWith(args, undefined);
  });

  it("dispatches public work services and forwards the run's cancellation signal", async () => {
    const controller = new AbortController();
    const signal = controller.signal;
    expect(await call("work_service", { action: "list" }, signal)).toEqual({ services: WORK_SERVICES });
    await call("work_service", { action: "market", country: "AE" }, signal);
    await call("work_service", { action: "holiday_countries" }, signal);
    await call("work_service", { action: "holidays", country: "DE", year: 2026 }, signal);
    await call("work_service", { action: "assets", query: "office", limit: 3 }, signal);
    expect(getCountryMarketData).toHaveBeenCalledExactlyOnceWith("AE", { signal });
    expect(listHolidayCountries).toHaveBeenCalledExactlyOnceWith({ signal });
    expect(getPublicHolidays).toHaveBeenCalledExactlyOnceWith("DE", 2026, { signal });
    expect(searchCreativeAssets).toHaveBeenCalledExactlyOnceWith("office", { limit: 3, signal });
    controller.abort();
    await expect(call("work_service", { action: "market", country: "AE" }, signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(getCountryMarketData).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("social publishing boundaries", () => {
  const args = { account_ids: ["social-1"], content: "Reviewed test post" };

  it("does not publish if account discovery outlives its workspace", async () => {
    vi.mocked(zernio.listAccounts).mockImplementationOnce(async () => {
      setCacheOrg("another-org", "another-user");
      return [{ id: "social-1", platform: "instagram" }];
    });
    expect(await call("schedule_social_post", args)).toMatchObject({ error: expect.stringMatching(/workspace changed/i) });
    expect(zernio.createPost).not.toHaveBeenCalled();
  });

  it("rejects remote customers and marks uncertain publication unsafe to retry", async () => {
    expect(await runTool("schedule_social_post", args, () => true, false)).toMatchObject({ error: expect.stringMatching(/owner-only/) });
    expect(zernio.listAccounts).not.toHaveBeenCalled();
    vi.mocked(zernio.createPost).mockRejectedValueOnce(new Error("Provider response lost"));
    expect(await call("schedule_social_post", args)).toMatchObject({ error: "Provider response lost", retry_safe: false });
    expect(zernio.createPost).toHaveBeenCalledTimes(1);
    expect(desktopBrowserCommand).not.toHaveBeenCalled();
  });
});


it("lets the owner hide branding and apply saved marks at full opacity without resaving invoice lines", async () => {
  const mark = { data: "data:image/png;base64,fixture", x: 75, y: 70, opacity: 30 };
  vi.mocked(billing.getDoc).mockResolvedValue(document({ status: "paid", stamp: mark, signature: mark }));
  const update = vi.spyOn(billing, "updateAppearance").mockResolvedValue();
  const save = vi.spyOn(billing, "saveDoc");
  const args = { invoice_number: "INV-12", show_logo: false, show_stamp: true, show_signature: true, stamp_opacity: 100, signature_opacity: 100 };
  expect(await call("update_invoice_appearance", args)).toMatchObject({ ok: true });
  expect(update).toHaveBeenCalledWith(12, expect.objectContaining({ show_logo: false, show_stamp: true, show_signature: true,
    stamp: expect.objectContaining({ opacity: 100, data: mark.data }), signature: expect.objectContaining({ opacity: 100, data: mark.data }) }));
  expect(save).not.toHaveBeenCalled();
  update.mockClear();
  expect(await runTool("update_invoice_appearance", args, () => true, false)).toMatchObject({ error: expect.stringMatching(/owner-only/) });
  expect(await call("update_invoice_appearance", { ...args, stamp_opacity: 101 })).toMatchObject({ code: "invalid_arguments" });
  vi.mocked(billing.getDoc).mockResolvedValue(document());
  expect(await call("update_invoice_appearance", args)).toMatchObject({ error: expect.stringMatching(/No saved stamp/) });
  expect(update).not.toHaveBeenCalled();
});
