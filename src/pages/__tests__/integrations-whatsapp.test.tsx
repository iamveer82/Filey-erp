import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import Integrations from "../Integrations";
import * as bridge from "../../lib/waBridge";

const native = vi.hoisted(() => ({ desktop: true, listener: (_state: { state: string; qr?: string; me?: string }) => {} }));
vi.mock("../../components/EmailConnection", () => ({ default: () => null }));
vi.mock("../../lib/ui", () => ({ useUI: () => ({ notice: vi.fn() }) }));
vi.mock("../../lib/composio", async (original) => ({
  ...await original<typeof import("../../lib/composio")>(),
  composioKeySource: async () => "none", hasOwnComposioKey: async () => false,
}));
vi.mock("../../lib/zernio", async (original) => ({
  ...await original<typeof import("../../lib/zernio")>(),
  listAccounts: async () => [], zernioKeySource: async () => "none", usingOwnZernioKey: async () => false,
}));
vi.mock("../../lib/waLog", () => ({ waLogList: () => [] }));
vi.mock("../../lib/waBridge", () => ({
  get hasDesktop() { return native.desktop; },
  bridgeState: vi.fn(), startBridge: vi.fn(), stopBridge: vi.fn(), resetBridge: vi.fn(),
  getBridgeConfig: vi.fn(() => ({ autoStart: false, ownerNumber: "" })),
  setBridgeConfig: vi.fn(),
  onBridgeState: vi.fn((listener) => { native.listener = listener; return vi.fn(); }),
}));
function Location() { const location = useLocation(); return <output>{location.pathname}{location.search}</output>; }
function show(tab = "available") {
  return render(<MemoryRouter initialEntries={[`/integrations?tab=${tab}`]}><Integrations /><Location /></MemoryRouter>);
}
beforeEach(() => {
  vi.clearAllMocks();
  native.desktop = true;
  vi.mocked(bridge.bridgeState).mockReset().mockResolvedValue({ state: "stopped" });
  vi.mocked(bridge.startBridge).mockReset().mockResolvedValue({ state: "starting" });
  vi.mocked(bridge.getBridgeConfig).mockReturnValue({ autoStart: false, ownerNumber: "" });
  vi.mocked(bridge.setBridgeConfig).mockImplementation(cfg => ({ autoStart: false, ownerNumber: "", ...cfg }));
});
afterEach(cleanup);

it("explains self-chat when the configured owner is the paired phone itself", async () => {
  vi.mocked(bridge.getBridgeConfig).mockReturnValue({ autoStart: true, ownerNumber: "971500000001" });
  vi.mocked(bridge.bridgeState).mockResolvedValue({ state: "connected", me: "971500000001:2@s.whatsapp.net" });
  show("free");
  expect(await screen.findByText(/Message yourself/)).toBeInTheDocument();
  expect(screen.queryByText(/From your owner number/)).not.toBeInTheDocument();
});

it("opens built-in pairing from the directory and connects without visiting CRM", async () => {
  show();
  fireEvent.click(screen.getByRole("link", { name: "Set up WhatsApp" }));
  const card = within(screen.getByRole("region", { name: "WhatsApp connection" }));
  await waitFor(() => expect(bridge.bridgeState).toHaveBeenCalledOnce());
  expect(screen.getByText("/integrations?tab=free")).toBeInTheDocument();
  expect(card.queryByRole("link", { name: "Open contacts" })).not.toBeInTheDocument();
  expect(bridge.startBridge).not.toHaveBeenCalled();
  const qr = "data:image/png;base64,iVBORw0KGgo=";
  let finish!: (state: { state: string }) => void;
  vi.mocked(bridge.startBridge).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  vi.mocked(bridge.bridgeState).mockResolvedValue({ state: "connecting", qr });
  fireEvent.click(card.getByRole("button", { name: "Connect WhatsApp" }));
  expect(card.getByRole("button", { name: "Connecting…" })).toBeDisabled();
  fireEvent.click(card.getByRole("button", { name: "Connecting…" }));
  await act(async () => { finish({ state: "starting" }); });
  expect(bridge.startBridge).toHaveBeenCalledOnce();
  expect(card.getByAltText("WhatsApp pairing QR code")).toHaveAttribute("src", qr);
  expect(card.getByText(/Linked devices/)).toBeInTheDocument();
  act(() => native.listener({ state: "connected", me: "971500000001@s.whatsapp.net" }));
  expect(card.getByRole("button", { name: "WhatsApp connected" })).toBeDisabled();
  expect(card.queryByAltText("WhatsApp pairing QR code")).not.toBeInTheDocument();
});

it("shows native startup failures and allows retry", async () => {
  show("free");
  vi.mocked(bridge.startBridge).mockRejectedValueOnce(new Error("WhatsApp bridge binary is not installed with this build"));
  fireEvent.click(screen.getByRole("button", { name: "Connect WhatsApp" }));
  expect(await within(screen.getByRole("region", { name: "WhatsApp connection" })).findByRole("status")).toHaveTextContent("Install the latest Filey update");
  expect(screen.queryByText(/bridge binary is not installed/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Connect WhatsApp" })).toBeEnabled();
  expect(screen.getByText("/integrations?tab=free")).toBeInTheDocument();
});

it.each([
  ["WhatsApp bridge could not start. Review the desktop logs and reconnect.", "WhatsApp could not start on this computer"],
  ["could not start bridge: unexpected native failure", "WhatsApp could not start on this computer"],
  ["WhatsApp could not save its pairing. Check free disk space, then reconnect.", "Check free disk space and folder permissions"],
  ["WhatsApp rejected this session. Close other Filey instances, then reconnect or re-pair in Integrations.", "WhatsApp rejected or replaced this session"],
  ["Could not read WhatsApp connection status: native failure", "Filey could not check the WhatsApp connection"],
  ["WhatsApp is already running in another Filey window. Close that window before connecting here.", "Close that window, then connect here"],
  ["Could not protect the WhatsApp session: access denied", "Filey cannot access its WhatsApp session files"],
  ["Could not clear WhatsApp pairing: access denied", "Filey could not remove the old WhatsApp pairing"],
  ["WhatsApp could not reconnect. Restart the bridge in Integrations.", "The WhatsApp connection was lost"],
  ["Unknown provider failure", "WhatsApp could not complete this action"],
])("explains connection failure safely: %s", async (error, message) => {
  vi.mocked(bridge.bridgeState).mockResolvedValue({ state: "error", error: `${error} [PRIVATE_DIAGNOSTIC]` });
  show("free");
  const status = await within(screen.getByRole("region", { name: "WhatsApp connection" })).findByRole("status");
  expect(status).toHaveTextContent(message);
  expect(status).not.toHaveTextContent("PRIVATE_DIAGNOSTIC");
  expect(screen.getByRole("button", { name: "Connect WhatsApp" })).toBeEnabled();
});

it("explains the desktop requirement in a browser without calling native commands", () => {
  native.desktop = false;
  show("free");
  expect(screen.getByText(/This browser cannot pair a WhatsApp account/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Connect WhatsApp" })).toBeDisabled();
  expect(bridge.bridgeState).not.toHaveBeenCalled();
  expect(bridge.startBridge).not.toHaveBeenCalled();
});

it("does not overwrite a live QR with an older initial status response", async () => {
  let finish!: (state: { state: string }) => void;
  vi.mocked(bridge.bridgeState).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  show("free");
  act(() => native.listener({ state: "connecting", qr: "data:image/png;base64,iVBORw0KGgo=" }));
  await act(async () => { finish({ state: "stopped" }); });
  expect(screen.getByAltText("WhatsApp pairing QR code")).toBeInTheDocument();
});

it("keeps the provider setup shortcut pointed at the same built-in connection", async () => {
  show("providers");
  fireEvent.click(screen.getByRole("link", { name: "Set up WhatsApp (QR)" }));
  expect(await screen.findByRole("region", { name: "WhatsApp connection" })).toBeInTheDocument();
  expect(screen.getByText("/integrations?tab=free")).toBeInTheDocument();
});

it("only changes the allowed owner number after an explicit save", async () => {
  show("free");
  const input = screen.getByRole("textbox", { name: "My WhatsApp number" });
  fireEvent.change(input, { target: { value: "+971500000002" } });
  fireEvent.blur(input);
  expect(bridge.setBridgeConfig).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save number" }));
  await waitFor(() => expect(bridge.setBridgeConfig).toHaveBeenCalledWith({ ownerNumber: "+971500000002" }));
});

it("lets customers clear directory filters and find the built-in connection again", async () => {
  show();
  fireEvent.change(screen.getByRole("textbox", { name: "Search integrations" }), { target: { value: "no-such-filey-integration" } });
  expect(screen.getByText("No matching integrations")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(screen.getByRole("link", { name: "Set up WhatsApp" })).toBeInTheDocument();
});
