import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act, cleanup } from "@testing-library/react";
import DataModePanel from "../settings/DataModePanel";
import { setImplicitDataMode } from "../../lib/dataMode";

const cloud = vi.hoisted(() => ({
  session: "owner@example.test" as string | null,
  switchWorkspace: vi.fn(async () => {}),
  migrateLocalToCloud: vi.fn(async () => [] as { table: string; rows: number; error?: string }[]),
  hasLocalData: vi.fn(async () => true),
  reload: false,
}));

// vi.mock factories are hoisted, so the mode fixture has to be too.
const mode = vi.hoisted(() => ({ value: "local" as "local" | "cloud" }));

vi.mock("../../lib/dataMode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/dataMode")>()),
  getDataMode: () => (mode.value === "local" ? "local" : null),
  effectiveDataMode: () => mode.value,
  isLocalMode: () => mode.value === "local",
}));

// The panel asks Supabase directly whether a cloud account exists — in local
// mode the app user is the DEVICE account, so only this can answer.
vi.mock("../../lib/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/supabase")>()),
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: cloud.session ? { user: { email: cloud.session } } : null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));

vi.mock("../../lib/switchWorkspace", () => ({ switchWorkspace: cloud.switchWorkspace }));
vi.mock("../../lib/migrate", () => ({
  migrateLocalToCloud: cloud.migrateLocalToCloud,
  migrateCloudToLocal: vi.fn(async () => []),
  normalizeLocalEmirates: vi.fn(async () => 0),
}));
vi.mock("../../lib/license", () => ({ hasLocalData: cloud.hasLocalData }));
vi.mock("../../lib/sync", () => ({
  autoSyncEnabled: () => false,
  setAutoSyncEnabled: vi.fn(),
  getSyncStatus: () => ({ state: "idle" as const, at: null }),
  syncStatusMessage: () => "",
  syncNow: vi.fn(async () => true),
  syncCycle: vi.fn(async () => true),
  markAllForSync: vi.fn(async () => {}),
  cloudSignIn: vi.fn(),
  cloudSignUp: vi.fn(),
  cloudSignOut: vi.fn(),
  setMigrating: vi.fn(),
  isMigrating: () => false,
  type: {},
}));
vi.mock("../../lib/api", () => ({ pendingCloudWrites: async () => [] }));
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
  cloud.switchWorkspace.mockClear();
  cloud.migrateLocalToCloud.mockClear().mockResolvedValue([]);
  cloud.hasLocalData.mockClear().mockResolvedValue(true);
  confirm.mockClear().mockResolvedValue(true);
  cloud.reload = false;
  vi.stubGlobal("location", { ...window.location, reload: () => { cloud.reload = true; } });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows the store as off while the records are on this device", async () => {
  render(<DataModePanel />);
  expect(await screen.findByRole("switch")).toHaveAttribute("aria-checked", "false");
  expect(screen.getByText(/stay on this device only/i)).toBeInTheDocument();
});

it("shows the store as on and names the account holding the records", async () => {
  mode.value = "cloud";
  render(<DataModePanel />);
  expect(await screen.findByRole("switch")).toHaveAttribute("aria-checked", "true");
  expect(screen.getByText(/owner@example\.test/)).toBeInTheDocument();
});

it("asks before uploading, and uploads only after the user agrees", async () => {
  render(<DataModePanel />);
  await flip();

  expect(confirm).toHaveBeenCalledOnce();
  expect(confirm.mock.calls[0][0]).toMatchObject({ confirmLabel: "Upload and turn on" });
  expect(confirm.mock.calls[0][0].message).toMatch(/uploads the records saved on this device/i);
  expect(cloud.migrateLocalToCloud).toHaveBeenCalledOnce();
  await waitFor(() => expect(cloud.switchWorkspace).toHaveBeenCalledWith("cloud", false));
  expect(cloud.reload).toBe(true);
});

it("cancelling the consent prompt leaves the records on this device", async () => {
  confirm.mockResolvedValue(false);
  render(<DataModePanel />);
  await flip();

  expect(cloud.migrateLocalToCloud).not.toHaveBeenCalled();
  expect(cloud.switchWorkspace).not.toHaveBeenCalled();
  expect(cloud.reload).toBe(false);
});

it("stays put and explains when the upload only partly succeeded", async () => {
  cloud.migrateLocalToCloud.mockResolvedValue([{ table: "orders", rows: 0, error: "denied" }]);
  render(<DataModePanel />);
  await flip();

  expect(await screen.findByRole("alert")).toHaveTextContent(/upload incomplete for: orders/i);
  expect(cloud.switchWorkspace).not.toHaveBeenCalled();
  expect(cloud.reload).toBe(false);
});

it("turning the store off never uploads and never asks", async () => {
  mode.value = "cloud";
  render(<DataModePanel />);
  await flip();

  expect(confirm).not.toHaveBeenCalled();
  expect(cloud.migrateLocalToCloud).not.toHaveBeenCalled();
  await waitFor(() => expect(cloud.switchWorkspace).toHaveBeenCalledWith("local", false));
});

it("sends the user to connect an account rather than opening an empty store", async () => {
  cloud.session = null;
  render(<DataModePanel />);
  await flip();

  expect(await screen.findByRole("alert")).toHaveTextContent(/connect your filey account/i);
  expect(cloud.migrateLocalToCloud).not.toHaveBeenCalled();
  expect(cloud.switchWorkspace).not.toHaveBeenCalled();
});

it("skips the upload entirely when this device holds no records", async () => {
  cloud.hasLocalData.mockResolvedValue(false);
  render(<DataModePanel />);
  await flip();

  expect(confirm).toHaveBeenCalledOnce();
  expect(cloud.migrateLocalToCloud).not.toHaveBeenCalled();
  await waitFor(() => expect(cloud.switchWorkspace).toHaveBeenCalledWith("cloud", false));
});

it("keeps the switch still while a transfer is running", async () => {
  let release!: () => void;
  cloud.migrateLocalToCloud.mockImplementation(() => new Promise((resolve) => {
    release = () => resolve([]);
  }));
  render(<DataModePanel />);
  await flip();

  await waitFor(() => expect(switcher()).toBeDisabled());
  release();
  await waitFor(() => expect(cloud.switchWorkspace).toHaveBeenCalled(), { timeout: 3000 });
});
