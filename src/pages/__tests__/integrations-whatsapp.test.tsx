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
  getBridgeConfig: () => ({ autoStart: false, ownerNumber: "" }),
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
});
afterEach(cleanup);

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
  expect(await within(screen.getByRole("region", { name: "WhatsApp connection" })).findByRole("status")).toHaveTextContent("bridge binary is not installed");
  expect(screen.getByRole("button", { name: "Connect WhatsApp" })).toBeEnabled();
  expect(screen.getByText("/integrations?tab=free")).toBeInTheDocument();
});

it("explains the desktop requirement in a browser without calling native commands", () => {
  native.desktop = false;
  show("free");
  expect(screen.getByText(/This browser preview cannot run the WhatsApp bridge/)).toBeInTheDocument();
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
