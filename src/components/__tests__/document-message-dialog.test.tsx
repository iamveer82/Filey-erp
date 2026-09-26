import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import DocumentMessageDialog from "../DocumentMessageDialog";
import { bridgeState, sendWaFile } from "../../lib/waBridge";
import { deliverFile } from "../../lib/agentFiles";
import { openMessageDraft, prepareWhatsAppDocument } from "../../lib/documentMessage";
import { sendWhatsAppWithComputer } from "../../lib/whatsappComputerSend";

const identity = vi.hoisted(() => ({ scope: "local:org:user", computer: false }));
vi.mock("../../lib/computerUse", () => ({ computerUseSupported: () => identity.computer }));
vi.mock("../../lib/whatsappComputerSend", () => ({ sendWhatsAppWithComputer: vi.fn() }));
vi.mock("../../lib/agentStorage", () => ({
  agentStorageScope: () => identity.scope,
  AGENT_STORAGE_EVENT: "filey:agent-storage",
  requireAgentStorageScope: (expected?: string) => {
    if (!identity.scope || (expected && expected !== identity.scope)) throw new Error("Your workspace changed.");
    return identity.scope;
  },
}));

vi.mock("../../lib/waBridge", () => ({
  hasDesktop: true, bridgeState: vi.fn(), onBridgeState: () => () => {}, sendWaFile: vi.fn(async () => "provider-id"),
}));
vi.mock("../../lib/agentFiles", () => ({ deliverFile: vi.fn() }));
vi.mock("../../lib/documentMessage", async (original) => ({
  ...await original<typeof import("../../lib/documentMessage")>(), openMessageDraft: vi.fn(async () => ({})), prepareWhatsAppDocument: vi.fn(),
}));
vi.mock("../../lib/api", () => ({ billing: {} }));
const file = new File(["%PDF-invoice"], "Invoice-123.pdf", { type: "application/pdf" });
Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode("%PDF-invoice").buffer });
const props = { title: "Invoice 123", phone: "+971501234567", message: "Your invoice", channel: "whatsapp" as const, loadPdf: async () => file, onClose: vi.fn() };
beforeEach(() => {
  localStorage.clear();
  identity.scope = "local:org:user";
  identity.computer = false;
  vi.mocked(bridgeState).mockResolvedValue({ state: "connected" });
  vi.mocked(deliverFile).mockResolvedValue({ name: file.name, path: "C:/Exports/Invoice-123.pdf" });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it("requires a valid recipient and reports provider acceptance only once", async () => {
  render(<DocumentMessageDialog {...props} phone="0501234567" />);
  const send = await screen.findByRole("button", { name: "Send PDF via paired WhatsApp" });
  await waitFor(() => expect(send).toBeEnabled());
  fireEvent.click(send);
  await screen.findByText(/Enter an international phone number/);
  expect(sendWaFile).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Recipient phone"), { target: { value: props.phone } });
  fireEvent.click(send);
  await screen.findByRole("button", { name: "PDF accepted by WhatsApp" });
  expect(sendWaFile).toHaveBeenCalledExactlyOnceWith("971501234567@s.whatsapp.net", { path: "C:/Exports/Invoice-123.pdf", filename: file.name, mimetype: file.type, caption: "Your invoice" });
  expect(screen.getByRole("button", { name: "PDF accepted by WhatsApp" })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("no delivery receipt yet");
  fireEvent.change(screen.getByLabelText("Recipient phone"), { target: { value: "+971 50 123 4567" } });
  expect(screen.getByRole("button", { name: "PDF accepted by WhatsApp" })).toBeDisabled();
});

it("rechecks the bridge and does not send after disconnecting", async () => {
  render(<DocumentMessageDialog {...props} />);
  const send = await screen.findByRole("button", { name: "Send PDF via paired WhatsApp" });
  await waitFor(() => expect(send).toBeEnabled());
  vi.mocked(bridgeState).mockResolvedValue({ state: "stopped" });
  fireEvent.click(send);
  await screen.findByText(/WhatsApp disconnected/);
  expect(sendWaFile).not.toHaveBeenCalled();
  expect(deliverFile).not.toHaveBeenCalled();
});

it("never reports acceptance or automatically retries an uncertain send", async () => {
  vi.mocked(sendWaFile).mockRejectedValueOnce(new Error("Delivery timed out. Check WhatsApp before retrying."));
  render(<DocumentMessageDialog {...props} />);
  const send = await screen.findByRole("button", { name: "Send PDF via paired WhatsApp" });
  await waitFor(() => expect(send).toBeEnabled());
  fireEvent.click(send);
  await screen.findByText(/Check WhatsApp before retrying/);
  expect(sendWaFile).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "PDF accepted by WhatsApp" })).not.toBeInTheDocument();
});

it("opens an SMS draft with an explicitly added link and no PDF claim", async () => {
  const createLink = vi.fn(async () => "https://billing.example.com/#/portal/123");
  render(<DocumentMessageDialog {...props} channel="sms" createLink={createLink} />);
  expect(createLink).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Add invoice link" }));
  await screen.findByText("Invoice link included");
  fireEvent.click(screen.getByRole("button", { name: "Open SMS draft" }));
  await waitFor(() => expect(openMessageDraft).toHaveBeenCalledWith("sms", props.phone, "Your invoice\n\nhttps://billing.example.com/#/portal/123", expect.objectContaining({ expectedScope: identity.scope })));
  expect(screen.getByText(/SMS sends the message/)).toHaveTextContent("without a PDF attachment");
  expect(sendWaFile).not.toHaveBeenCalled();
});

it("prepares files before native sharing and treats cancellation as unsent", async () => {
  const share = vi.fn().mockRejectedValue(new DOMException("Cancelled", "AbortError"));
  vi.stubGlobal("navigator", { canShare: () => true, share });
  render(<DocumentMessageDialog {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "Share PDF" }));
  await waitFor(() => expect(share).toHaveBeenCalledWith({ files: [file], title: props.title, text: props.message }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Share PDF" })).toBeEnabled());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("explains manual attachments when WhatsApp is not paired and labels the text-only action", async () => {
  vi.mocked(bridgeState).mockResolvedValue({ state:"stopped" });
  render(<DocumentMessageDialog {...props} />);
  await screen.findByText(file.name);
  expect(screen.getByText(/Attach → Document/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name:"WhatsApp setup" })).toHaveAttribute("href", "#/integrations?tab=free");
  expect(screen.getByRole("button", { name:"Prepare WhatsApp + PDF" })).toHaveClass("btn-primary");
  expect(screen.queryByRole("button", { name:"Send PDF via paired WhatsApp" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name:"Open WhatsApp text draft" }));
  await waitFor(() => expect(openMessageDraft).toHaveBeenCalledWith("whatsapp", props.phone, props.message, expect.objectContaining({ expectedScope: identity.scope })));
  expect(await screen.findByRole("status")).toHaveTextContent("attach the downloaded invoice");
});

it("shows an unsent handoff and the actual saved PDF path", async () => {
  vi.mocked(bridgeState).mockResolvedValue({ state: "stopped" });
  vi.mocked(prepareWhatsAppDocument).mockResolvedValue({ status: "draft", sent: false, attachmentRequired: true, draftOpened: true, path: "C:/Exports/Invoice-123.pdf", filename: file.name, phone: props.phone, text: props.message });
  render(<DocumentMessageDialog {...props} />);
  const prepare = await screen.findByRole("button", { name: "Prepare WhatsApp + PDF" });
  await waitFor(() => expect(prepare).toBeEnabled());
  fireEvent.click(prepare);
  expect(await screen.findByRole("status")).toHaveTextContent("Nothing sent");
  expect(screen.getByText("C:/Exports/Invoice-123.pdf")).toBeInTheDocument();
  expect(prepareWhatsAppDocument).toHaveBeenCalledWith(expect.objectContaining({ file, phone: props.phone, text: props.message, expectedScope: identity.scope }));
  expect(sendWaFile).not.toHaveBeenCalled();
});

it("stops a pending PDF send when the workspace changes during saving", async () => {
  let finishSave!: (value: { name: string; path: string }) => void;
  vi.mocked(deliverFile).mockReturnValueOnce(new Promise(resolve => { finishSave = resolve; }));
  render(<DocumentMessageDialog {...props} />);
  const send = await screen.findByRole("button", { name: "Send PDF via paired WhatsApp" });
  await waitFor(() => expect(send).toBeEnabled());
  fireEvent.click(send);
  await waitFor(() => expect(deliverFile).toHaveBeenCalledTimes(1));
  identity.scope = "cloud:other-org:user";
  fireEvent(window, new Event("filey:agent-storage"));
  finishSave({ name: file.name, path: "C:/Exports/Invoice-123.pdf" });
  await screen.findByText(/Your workspace changed/);
  expect(send).toBeDisabled();
  expect(sendWaFile).not.toHaveBeenCalled();
  expect(screen.queryByText("C:/Exports/Invoice-123.pdf")).not.toBeInTheDocument();
});

it("removes the previous PDF when a replacement export fails", async () => {
  const view = render(<DocumentMessageDialog {...props} />);
  await screen.findByText(file.name);
  view.rerender(<DocumentMessageDialog {...props} loadPdf={async () => { throw new Error("Export failed"); }} />);
  await screen.findByText(/Export failed/);
  expect(screen.getByRole("button", { name: "Download PDF" })).toBeDisabled();
  expect(screen.queryByText(file.name)).not.toBeInTheDocument();
});

it("shows the desktop-only AI option honestly in the browser preview", async () => {
  render(<DocumentMessageDialog {...props} />);
  expect(screen.getByRole("button", { name: "Send with Filey AI" })).toBeDisabled();
  expect(screen.getByText(/localhost\/browser preview/)).toBeInTheDocument();
  expect(sendWhatsAppWithComputer).not.toHaveBeenCalled();
});

it("starts the reviewed computer task from one click and prevents another send after uncertainty", async () => {
  identity.computer = true;
  vi.mocked(sendWhatsAppWithComputer).mockImplementation(async input => {
    input.onProgress?.({ message: "Sending…", sendAttempted: true, path: "C:/Exports/Invoice-123.pdf" });
    return { status: "unknown", sendAttempted: true, message: "Check WhatsApp before sending another copy." };
  });
  render(<DocumentMessageDialog {...props} />);
  const send = screen.getByRole("button", { name: "Send with Filey AI" });
  await waitFor(() => expect(send).toBeEnabled());
  fireEvent.click(send);
  await screen.findByText("Check WhatsApp before sending another copy.");
  expect(sendWhatsAppWithComputer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    file, phone: props.phone, text: props.message, expectedScope: identity.scope, signal: expect.any(AbortSignal),
  }));
  expect(screen.getByRole("button", { name: "Check the send in WhatsApp" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Send PDF via paired WhatsApp" })).toBeDisabled();
  expect(sendWaFile).not.toHaveBeenCalled();
});

it("lets the user stop the computer task and reports it without a sent claim", async () => {
  identity.computer = true;
  vi.mocked(sendWhatsAppWithComputer).mockImplementation(input => new Promise(resolve => {
    input.signal!.addEventListener("abort", () => resolve({ status: "stopped", sendAttempted: false, message: "Filey AI stopped." }), { once: true });
  }));
  render(<DocumentMessageDialog {...props} />);
  const send = screen.getByRole("button", { name: "Send with Filey AI" });
  await waitFor(() => expect(send).toBeEnabled());
  fireEvent.click(send);
  await waitFor(() => expect(sendWhatsAppWithComputer).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Filey AI stopped.");
  expect(screen.getByRole("button", { name: "Send with Filey AI" })).toBeEnabled();
});
