import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Integrations from "../Integrations";

const state = vi.hoisted(() => ({
  scope: "cloud:org:a:user:a" as string | null,
  local: false,
  desktop: false,
  cloud: true,
  own: false,
  source: "none" as "none" | "own" | "platform",
  save: vi.fn(), remove: vi.fn(), list: vi.fn(), cloudKey: vi.fn(), deviceKey: vi.fn(),
  confirm: vi.fn(), connect: vi.fn(), status: vi.fn(), search: vi.fn(),
}));
vi.mock("../../components/FreeConnections", () => ({ default: () => null }));
vi.mock("../../components/WorkServices", () => ({ default: () => null }));
vi.mock("../../components/EmailConnection", () => ({ default: () => null }));
vi.mock("../../components/TelegramAgentConnection", () => ({ default: () => null }));
vi.mock("../../lib/ui", () => ({ useUI: () => ({ notice: vi.fn(), confirm: state.confirm }) }));
vi.mock("../../lib/agentStorage", () => ({ agentStorageScope: () => state.scope, AGENT_STORAGE_EVENT: "filey:agent-storage" }));
vi.mock("../../lib/dataMode", () => ({ isLocalMode: () => state.local }));
vi.mock("../../lib/supabase", () => ({ get cloudConfigured() { return state.cloud; } }));
vi.mock("../../lib/integrations", () => ({ hasCloudKey: state.cloudKey }));
vi.mock("../../lib/reach", () => ({ reachReady: () => false }));
vi.mock("../../lib/composio", () => ({
  get hasDesktop() { return state.desktop; },
  composioKeySource: async () => state.source,
  hasOwnComposioKey: state.deviceKey,
  setComposioKey: state.save, clearComposioKey: state.remove,
  composioList: state.list, composioConnect: state.connect, composioStatus: state.status,
  composioSearchToolkits: state.search,
  COMPOSIO_TOOLKITS: [{ slug: "gmail", name: "Gmail", desc: "Read and send email" }],
}));
vi.mock("../../lib/zernio", () => ({
  getZernioConfig: () => ({ apiKey: "", enabled: false }), setZernioConfig: vi.fn(),
  usingOwnZernioKey: () => false, zernioKeySource: async () => "none", listAccounts: async () => [],
}));
vi.mock("../../lib/waLog", () => ({ waLogList: () => [] }));
vi.mock("../../lib/waBridge", () => ({
  hasDesktop: false, getBridgeConfig: () => ({ autoStart: false, ownerNumber: "" }),
  setBridgeConfig: vi.fn(), bridgeState: vi.fn(), startBridge: vi.fn(), stopBridge: vi.fn(),
  resetBridge: vi.fn(), onBridgeState: () => () => {},
}));
vi.mock("../../lib/nativePlatform", () => ({ isNativeApp: () => false, openNativeExternal: vi.fn() }));

function show(tab = "available") {
  return render(<MemoryRouter initialEntries={[`/integrations?tab=${tab}`]}><Integrations /></MemoryRouter>);
}
async function setup() {
  show();
  await waitFor(() => expect(screen.getByRole("button", { name: "Refresh connected apps" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Use your own Composio key" }));
  return screen.findByLabelText("Composio API key");
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function changeWorkspace(scope: string | null, local = false) {
  state.scope = scope; state.local = local; state.own = false; state.source = "none";
  act(() => { window.dispatchEvent(new Event("filey:workspace-changed")); });
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  Object.assign(state, { scope: "cloud:org:a:user:a", local: false, desktop: false, cloud: true, own: false, source: "none" });
  state.cloudKey.mockReset().mockImplementation(async () => state.own);
  state.deviceKey.mockReset().mockImplementation(async () => state.own);
  state.save.mockReset().mockImplementation(async () => { state.own = true; state.source = "own"; });
  state.remove.mockReset().mockImplementation(async () => { state.own = false; state.source = "none"; });
  state.list.mockReset().mockResolvedValue({ items: [] });
  state.confirm.mockReset().mockResolvedValue(true);
  state.connect.mockReset(); state.status.mockReset(); state.search.mockReset().mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it("opens masked personal-key setup directly from the directory and does not persist the draft", async () => {
  const input = await setup();
  expect(input).toHaveAttribute("type", "password");
  expect(input).toHaveAttribute("autocomplete", "new-password");
  expect(screen.getByText(/app cannot read the saved key/)).toBeInTheDocument();
  fireEvent.change(input, { target: { value: "ak_synthetic_private_draft" } });
  expect(Object.values(localStorage)).not.toContain("ak_synthetic_private_draft");
  expect(state.save).not.toHaveBeenCalled();
  expect(state.cloudKey).toHaveBeenCalledWith("composio");
  expect(state.deviceKey).not.toHaveBeenCalled();
});

it("shows separate save and validation states, then refreshes apps after a successful check", async () => {
  const input = await setup();
  const save = deferred<void>(), check = deferred<{ items: [] }>();
  state.save.mockImplementationOnce(() => save.promise);
  state.list.mockImplementationOnce(() => check.promise);
  fireEvent.change(input, { target: { value: "ak_synthetic_valid" } });
  fireEvent.click(screen.getByRole("button", { name: "Save & check" }));
  expect(screen.getByRole("button", { name: "Saving key…" })).toBeDisabled();
  expect(state.list).not.toHaveBeenCalled();
  expect(screen.queryByText("Verified")).not.toBeInTheDocument();
  state.own = true; state.source = "own";
  await act(async () => { save.resolve(); });
  expect(screen.getByText("Key saved. Checking the connection…")).toBeInTheDocument();
  expect(screen.queryByText("Verified")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Checking connection…" })).toBeDisabled();
  await act(async () => { check.resolve({ items: [] }); });
  expect(await screen.findByText("Connection verified. Choose an app below and click Connect.")).toBeInTheDocument();
  expect(screen.getByText("Verified")).toBeInTheDocument();
  expect(state.save).toHaveBeenCalledOnce();
  expect(state.save).toHaveBeenCalledWith("ak_synthetic_valid");
  expect(state.list).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("button", { name: "Manage Composio key" })).toBeInTheDocument();
  const apps = within(screen.getByRole("region", { name: "More apps" }));
  expect(apps.getByRole("button", { name: "Connect" })).toBeEnabled();
  expect(screen.queryByLabelText("Composio API key")).not.toBeInTheDocument();
});

it("keeps a saved key distinct from a failed verification and never echoes secret provider errors", async () => {
  const input = await setup();
  state.list.mockRejectedValueOnce(new Error("Provider echoed ak_synthetic_do_not_echo"));
  fireEvent.change(input, { target: { value: "ak_synthetic_do_not_echo" } });
  fireEvent.click(screen.getByRole("button", { name: "Save & check" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Key saved, but Composio could not verify it");
  expect(screen.getByRole("alert")).not.toHaveTextContent("ak_synthetic_do_not_echo");
  expect(screen.queryByText("Verified")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Check connection" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
  expect(await screen.findByText("Verified")).toBeInTheDocument();
});

it("shows a safe save failure without pretending that a key was stored or checked", async () => {
  const input = await setup();
  state.save.mockRejectedValueOnce(new Error("DB secret ak_synthetic_hidden_failure"));
  fireEvent.change(input, { target: { value: "ak_synthetic_hidden_failure" } });
  fireEvent.click(screen.getByRole("button", { name: "Save & check" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not save your key");
  expect(screen.getByRole("alert")).not.toHaveTextContent("ak_synthetic_hidden_failure");
  expect(state.list).not.toHaveBeenCalled();
  expect(screen.queryByText("Own key")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save & check" })).toBeEnabled();
});

it("rejects key drafts containing spaces before saving", async () => {
  const input = await setup();
  fireEvent.change(input, { target: { value: "ak_bad key" } });
  fireEvent.click(screen.getByRole("button", { name: "Save & check" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("without spaces or line breaks");
  expect(state.save).not.toHaveBeenCalled();
});

it("lets users replace and remove their key, and does not claim removal revokes app authorizations", async () => {
  state.own = true; state.source = "own";
  show("providers");
  fireEvent.click(await screen.findByRole("button", { name: "Replace key" }));
  const input = screen.getByLabelText("Composio API key");
  fireEvent.change(input, { target: { value: "ak_synthetic_replacement" } });
  fireEvent.submit(input.closest("form")!);
  await screen.findByText("Verified");
  expect(state.save).toHaveBeenCalledWith("ak_synthetic_replacement");
  fireEvent.click(screen.getByRole("button", { name: "Remove key" }));
  await waitFor(() => expect(state.remove).toHaveBeenCalledOnce());
  expect(state.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Remove Composio key?", danger: true }));
  expect(await screen.findByText("Your key was removed. App authorizations remain in your Composio account.")).toBeInTheDocument();
  expect(screen.getByLabelText("Composio API key")).toHaveValue("");
  expect(screen.queryByText("Own key")).not.toBeInTheDocument();
});

it("keeps the current key when removal is cancelled or fails", async () => {
  state.own = true; state.source = "own";
  show("providers");
  const remove = await screen.findByRole("button", { name: "Remove key" });
  state.confirm.mockResolvedValueOnce(false);
  fireEvent.click(remove);
  await waitFor(() => expect(state.confirm).toHaveBeenCalledOnce());
  expect(state.remove).not.toHaveBeenCalled();
  state.remove.mockRejectedValueOnce(new Error("ak_synthetic_remove_error"));
  fireEvent.click(remove);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not remove your key");
  expect(screen.getByRole("alert")).not.toHaveTextContent("ak_synthetic_remove_error");
  expect(screen.getByText("Own key")).toBeInTheDocument();
});

it("does not offer or upload a personal key in browser-local mode", async () => {
  state.local = true; state.scope = "local:org:a:user:a";
  show();
  fireEvent.click(screen.getByRole("button", { name: "Use your own Composio key" }));
  expect(screen.getByText(/Local mode keeps your settings on this device/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Choose cloud mode" })).toHaveAttribute("href", "/settings?section=datamode");
  expect(screen.queryByLabelText("Composio API key")).not.toBeInTheDocument();
  expect(state.cloudKey).not.toHaveBeenCalled();
  expect(state.save).not.toHaveBeenCalled();
});

it("uses the installed desktop key store in local mode instead of cloud metadata", async () => {
  state.desktop = true; state.local = true; state.scope = "local:org:a:user:a";
  const input = await setup();
  expect(screen.getByText(/device's encrypted credential store/)).toBeInTheDocument();
  expect(state.deviceKey).toHaveBeenCalledOnce();
  expect(state.cloudKey).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "ak_synthetic_device_key" } });
  fireEvent.click(screen.getByRole("button", { name: "Save & check" }));
  expect(await screen.findByText("Verified")).toBeInTheDocument();
});

it("requires a signed-in workspace before editing a cloud key", async () => {
  state.scope = null;
  show("providers");
  expect(screen.getByText(/Sign in to a cloud workspace/)).toBeInTheDocument();
  expect(screen.queryByLabelText("Composio API key")).not.toBeInTheDocument();
  expect(state.cloudKey).not.toHaveBeenCalled();
});

it.each(["account", "mode"])("clears drafts and ignores a pending save after a %s change", async change => {
  const input = await setup();
  const pending = deferred<void>();
  state.save.mockImplementationOnce(() => pending.promise);
  fireEvent.change(input, { target: { value: "ak_synthetic_previous_owner" } });
  fireEvent.click(screen.getByRole("button", { name: "Save & check" }));
  changeWorkspace(change === "account" ? "cloud:org:b:user:b" : "local:org:a:user:a", change === "mode");
  expect(screen.queryByLabelText("Composio API key")).not.toBeInTheDocument();
  await act(async () => { pending.resolve(); });
  expect(state.list).not.toHaveBeenCalled();
  expect(screen.queryByText("Own key")).not.toBeInTheDocument();
  expect(screen.queryByText("Verified")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Use your own Composio key" }));
  if (change === "account") expect(await screen.findByLabelText("Composio API key")).toHaveValue("");
  else expect(screen.getByText(/Local mode keeps your settings on this device/)).toBeInTheDocument();
});

it("ignores delayed validation after an account change", async () => {
  const input = await setup();
  const pending = deferred<{ items: [] }>();
  state.list.mockImplementationOnce(() => pending.promise);
  fireEvent.change(input, { target: { value: "ak_synthetic_previous_owner" } });
  fireEvent.click(screen.getByRole("button", { name: "Save & check" }));
  await screen.findByText("Key saved. Checking the connection…");
  changeWorkspace("cloud:org:b:user:b");
  await act(async () => { pending.resolve({ items: [] }); });
  expect(screen.queryByText("Verified")).not.toBeInTheDocument();
  expect(screen.queryByText("Own key")).not.toBeInTheDocument();
  expect(screen.queryByText(/Connection verified/)).not.toBeInTheDocument();
});

it("ignores delayed saved-key metadata after an account change", async () => {
  const pending = deferred<boolean>();
  state.cloudKey.mockImplementationOnce(() => pending.promise);
  show("providers");
  await screen.findByText("Checking saved key…");
  changeWorkspace("cloud:org:b:user:b");
  expect(await screen.findByLabelText("Composio API key")).toHaveValue("");
  await act(async () => { pending.resolve(true); });
  expect(screen.queryByText("Own key")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove key" })).not.toBeInTheDocument();
});

it("does not remove another account's key after a delayed confirmation", async () => {
  state.own = true; state.source = "own";
  const pending = deferred<boolean>();
  state.confirm.mockImplementationOnce(() => pending.promise);
  show("providers");
  fireEvent.click(await screen.findByRole("button", { name: "Remove key" }));
  changeWorkspace("cloud:org:b:user:b");
  await act(async () => { pending.resolve(true); });
  expect(state.remove).not.toHaveBeenCalled();
});

it("reports metadata errors safely without claiming the connection is checked", async () => {
  state.cloudKey.mockRejectedValueOnce(new Error("ak_synthetic_metadata_error"));
  show("providers");
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not verify your saved integration key");
  expect(screen.getByRole("alert")).not.toHaveTextContent("ak_synthetic_metadata_error");
  expect(screen.queryByText("Verified")).not.toBeInTheDocument();
});

it("opens key setup from an app's Set up action without another settings page", async () => {
  show();
  const apps = within(await screen.findByRole("region", { name: "More apps" }));
  fireEvent.click(apps.getByRole("button", { name: "Set up" }));
  expect(await screen.findByLabelText("Composio API key")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Use your own Composio key" })).toHaveAttribute("aria-expanded", "true");
});

it("does not open a failed or incomplete app connection and hides raw provider errors", async () => {
  state.own = true; state.source = "own";
  const opened = vi.spyOn(window, "open").mockReturnValue(null);
  state.connect.mockRejectedValueOnce(new Error("ak_synthetic_start_failure"));
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Could not connect this app");
  expect(screen.getByRole("status")).not.toHaveTextContent("ak_synthetic_start_failure");
  state.connect.mockResolvedValueOnce({ redirect_url: "https://auth.composio.dev/synthetic" });
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  await waitFor(() => expect(state.connect).toHaveBeenCalledTimes(2));
  expect(opened).not.toHaveBeenCalled();
  expect(state.status).not.toHaveBeenCalled();
});

it("keeps a direct authorization link when popups are blocked and confirms the app only after ACTIVE", async () => {
  state.own = true; state.source = "own";
  const opened = vi.spyOn(window, "open").mockReturnValue(null);
  state.connect.mockResolvedValue({ redirect_url: "https://auth.composio.dev/synthetic", connected_account_id: "ca_synthetic" });
  state.status.mockResolvedValue({ status: "ACTIVE" });
  show();
  const connect = await screen.findByRole("button", { name: "Connect" });
  vi.useFakeTimers();
  fireEvent.click(connect);
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByRole("link", { name: "authorize gmail here" })).toHaveAttribute("href", "https://auth.composio.dev/synthetic");
  expect(opened).toHaveBeenCalledWith("https://auth.composio.dev/synthetic", "_blank", "noopener,noreferrer");
  expect(screen.queryByText("Connected")).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(screen.getByText("Connected")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "authorize gmail here" })).not.toBeInTheDocument();
  expect(state.status).toHaveBeenCalledWith("ca_synthetic");
});

it("does not open another account's authorization link after a delayed connect response", async () => {
  state.own = true; state.source = "own";
  const opened = vi.spyOn(window, "open").mockReturnValue(null);
  const pending = deferred<{ redirect_url: string; connected_account_id: string }>();
  state.connect.mockImplementationOnce(() => pending.promise);
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
  changeWorkspace("cloud:org:b:user:b");
  await act(async () => { pending.resolve({ redirect_url: "https://auth.composio.dev/synthetic", connected_account_id: "ca_synthetic" }); });
  expect(opened).not.toHaveBeenCalled();
  expect(state.status).not.toHaveBeenCalled();
  expect(screen.queryByRole("link", { name: "authorize gmail here" })).not.toBeInTheDocument();
});

it("discards search results and errors when the workspace changes", async () => {
  state.own = true; state.source = "own";
  const pending = deferred<[]>();
  state.search.mockImplementationOnce(() => pending.promise);
  show();
  await screen.findByRole("button", { name: "Connect" });
  fireEvent.change(screen.getByRole("textbox", { name: "Search integrations" }), { target: { value: "private customer search" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  changeWorkspace("cloud:org:b:user:b");
  await act(async () => { pending.reject(new Error("old_workspace_private_error")); });
  expect(screen.getByRole("textbox", { name: "Search integrations" })).toHaveValue("");
  expect(screen.queryByText(/old_workspace_private_error/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Search" })).toBeEnabled();
});
