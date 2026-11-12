import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act, cleanup } from "@testing-library/react";
import DataModePanel from "../settings/DataModePanel";
import { setImplicitDataMode } from "../../lib/dataMode";

// Cloud mode is off sale and no longer offered from local mode. The only
// switch left is the off-switch for people already working in the cloud: it
// brings the workspace back to this device without uploading anything.

const cloud = vi.hoisted(() => ({
  session: "owner@example.test" as string | null,
  switchWorkspace: vi.fn(async () => {}),
  pendingWrites: vi.fn(async () => [] as { id: number; op: string }[]),
  flushOutbox: vi.fn(async () => {}),
  reload: false,
  authEvents: false,
}));

// vi.mock factories are hoisted, so the mode fixture has to be too.
const mode = vi.hoisted(() => ({ value: "local" as "local" | "cloud" }));

vi.mock("../../lib/dataMode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/dataMode")>()),
  getDataMode: () => (mode.value === "local" ? "local" : null),
  effectiveDataMode: () => mode.value,
  isLocalMode: () => mode.value === "local",
}));

vi.mock("../../lib/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/supabase")>()),
  cloudConfigured: true,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: cloud.session ? { user: { email: cloud.session } } : null }, error: null }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        if (cloud.authEvents) cb("INITIAL_SESSION", cloud.session ? { user: { id: "owner-id", email: cloud.session } } : null);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  },
}));

vi.mock("../../lib/switchWorkspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/switchWorkspace")>()),
  switchWorkspace: cloud.switchWorkspace,
}));
vi.mock("../../lib/migrate", () => ({
  migrateCloudToLocal: vi.fn(async () => []),
  normalizeLocalEmirates: vi.fn(async () => 0),
}));
vi.mock("../../lib/sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/sync")>()),
  setMigrating: vi.fn(),
  isMigrating: () => false,
}));
vi.mock("../../lib/api", () => ({ pendingCloudWrites: cloud.pendingWrites, flushOutbox: cloud.flushOutbox }));
vi.mock("../../lib/cloudCopy", () => ({
  DEVICE_COPY_EVENT: "filey:device-copy",
  deviceCopyAt: () => null,
  deviceCopyInFlight: () => undefined,
}));
vi.mock("../../lib/localPaths", () => ({
  hasTauri: false,
  getExportDir: () => "",
  setExportDir: vi.fn(),
  clearExportDir: vi.fn(),
  openFolder: vi.fn(),
  getDataDir: async () => "",
  setDataDir: vi.fn(),
  restartApp: vi.fn(),
  storageRecoveryStatus: async () => null,
  cancelPendingStorage: vi.fn(),
  pickFolder: async () => null,
  backupAll: vi.fn(),
  restoreAll: vi.fn(),
}));
vi.mock("../../lib/auth", () => ({ useAuth: () => ({ user: null }) }));

const confirm = vi.hoisted(() =>
  vi.fn(async (_opts: { title: string; message?: string; confirmLabel?: string }) => true)
);
vi.mock("../../lib/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/ui")>()),
  useUI: () => ({
    confirm,
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), notify: vi.fn() },
    prompt: vi.fn(),
    notice: vi.fn(),
  }),
}));

const switcher = () => screen.getByRole("switch", { name: /store my data/i });
/** The switch is the whole control; a click is the one interaction we promise.
 *  It stays disabled until the device check resolves, so wait for that. */
const flip = async () => {
  await waitFor(() => expect(switcher()).toBeEnabled());
  await act(async () => { fireEvent.click(switcher()); });
};

beforeEach(() => {
  mode.value = "local";
  setImplicitDataMode(null);
  cloud.session = "owner@example.test";
  cloud.switchWorkspace.mockReset().mockResolvedValue();
  cloud.pendingWrites.mockReset().mockResolvedValue([]);
  cloud.flushOutbox.mockReset().mockResolvedValue();
  confirm.mockClear().mockResolvedValue(true);
  cloud.reload = false;
  cloud.authEvents = false;
  vi.stubGlobal("location", { ...window.location, reload: () => { cloud.reload = true; } });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("keeps records on this device and says cloud mode is coming soon", async () => {
  render(<DataModePanel />);
  expect(await screen.findByText("Filey Cloud")).toBeInTheDocument();
  expect(screen.getByText("Coming soon")).toBeInTheDocument();
  expect(screen.getByText(/Cloud mode is coming soon\. Until then your records stay on this computer/)).toBeInTheDocument();
  expect(screen.getByText(/Your records stay on this computer\. Cloud mode is coming soon\./)).toBeInTheDocument();
  expect(screen.queryByRole("switch")).toBeNull();
});

it("never offers a way to put local records in the cloud", async () => {
  render(<DataModePanel />);
  await screen.findByText("Filey Cloud");
  expect(screen.queryByRole("button", { name: /cloud/i })).toBeNull();
  expect(screen.queryByRole("button", { name: "Push local data to cloud" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Upload all local data" })).toBeNull();
  expect(screen.queryByText("Sync changes automatically")).toBeNull();
  expect(confirm).not.toHaveBeenCalled();
  expect(cloud.switchWorkspace).not.toHaveBeenCalled();
});

it("shows the store as on and names the account holding the records", async () => {
  mode.value = "cloud";
  render(<DataModePanel />);
  expect(await screen.findByRole("switch")).toHaveAttribute("aria-checked", "true");
  expect(screen.getByText(/owner@example\.test/)).toBeInTheDocument();
  expect(screen.queryByText("Coming soon")).toBeNull();
});

it("turning the store off never uploads and never asks", async () => {
  mode.value = "cloud";
  render(<DataModePanel />);
  await flip();

  expect(confirm).not.toHaveBeenCalled();
  await waitFor(() => expect(cloud.switchWorkspace).toHaveBeenCalledWith("local", expect.any(Function)));
  expect(cloud.reload).toBe(true);
});

it("keeps the current store open and explains when the switch back fails", async () => {
  mode.value = "cloud";
  cloud.switchWorkspace.mockRejectedValue(new Error("invoice_docs: permission denied; SQLSTATE 42501"));
  render(<DataModePanel />);
  await flip();

  expect(await screen.findByRole("alert")).toHaveTextContent(/your saved data is safe/i);
  expect(screen.queryByText(/invoice_docs|SQLSTATE|permission denied/i)).toBeNull();
  expect(cloud.reload).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(cloud.switchWorkspace).toHaveBeenCalledTimes(2));
});

it("shows retained queue counts and retries without exposing or deleting their data", async () => {
  mode.value = "cloud";
  cloud.pendingWrites.mockResolvedValue([{ id: 1, op: "private invoice customer details" }]);
  let finish!: () => void;
  cloud.flushOutbox.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<DataModePanel />);
  expect(await screen.findByText(/1 queued change remains/)).toBeInTheDocument();
  expect(screen.queryByText(/private invoice/)).toBeNull();
  const retry = screen.getByRole("button", { name: "Retry queued saves" });
  await waitFor(() => expect(retry).toBeEnabled());
  fireEvent.click(retry);
  expect(cloud.flushOutbox).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Retrying queued saves…" })).toBeDisabled();
  await act(async () => { finish(); });
  expect(await screen.findByRole("button", { name: "Retry queued saves" })).toBeEnabled();
  expect(screen.getByText(/1 queued change remains/)).toBeInTheDocument();
  expect(screen.getByText(/conflicts.*kept for review/)).toBeInTheDocument();
  expect(cloud.switchWorkspace).not.toHaveBeenCalled();
});

it.each(["filey:outbox-change", "focus"])("refreshes retained saves when %s fires", async event => {
  mode.value = "cloud";
  cloud.pendingWrites.mockResolvedValue([{ id: 1, op: "saved elsewhere" }]);
  render(<DataModePanel />);
  await screen.findByText(/1 queued change remains/);
  cloud.pendingWrites.mockResolvedValue([]);
  act(() => window.dispatchEvent(new Event(event)));
  await waitFor(() => expect(screen.queryByText(/queued change remains/)).toBeNull());
});

it("keeps queued saves visible after a retry failure without exposing server details", async () => {
  mode.value = "cloud";
  cloud.pendingWrites.mockResolvedValue([{ id: 1, op: "private customer data" }]);
  cloud.flushOutbox.mockRejectedValueOnce(new Error("private SQL error"));
  render(<DataModePanel />);
  const retry = await screen.findByRole("button", { name: "Retry queued saves" });
  await waitFor(() => expect(retry).toBeEnabled());
  fireEvent.click(retry);
  expect(await screen.findByRole("alert")).toHaveTextContent("Your queued changes are preserved");
  expect(screen.queryByText(/private SQL|private customer/)).toBeNull();
  expect(screen.getByText(/1 queued change remains/)).toBeInTheDocument();
});

it("does not replay legacy cloud saves while the user is in local mode", async () => {
  cloud.pendingWrites.mockResolvedValue([{ id: 1, op: "old cloud save" }]);
  render(<DataModePanel />);
  await screen.findByText(/1 queued change remains/);
  expect(screen.queryByRole("button", { name: "Retry queued saves" })).toBeNull();
  expect(screen.getByText(/Open the original cloud workspace/)).toBeInTheDocument();
  expect(cloud.flushOutbox).not.toHaveBeenCalled();
});

it("keeps the switch still while the transfer back is running", async () => {
  mode.value = "cloud";
  let release!: () => void;
  cloud.switchWorkspace.mockImplementation(() => new Promise((resolve) => {
    release = () => resolve();
  }));
  render(<DataModePanel />);
  await flip();

  await waitFor(() => expect(switcher()).toBeDisabled(), { timeout: 3000 });
  release();
  await waitFor(() => expect(cloud.switchWorkspace).toHaveBeenCalled(), { timeout: 3000 });
});
