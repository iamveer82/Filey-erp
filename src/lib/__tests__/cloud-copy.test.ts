import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  paid: true,
  cycle: vi.fn(async (..._args: unknown[]) => true),
  journal: { v: 1, tables: {} as Record<string, { changed: unknown[]; deleted: unknown[]; all?: boolean }> },
  local: true,
  owner: "owner" as string | null,
  copy: vi.fn(async () => [{ table: "invoice_docs", rows: 1 }] as { table: string; rows: number; error?: string }[]),
}));
vi.mock("../supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: m.session } }) } } }));
vi.mock("../dataMode", () => ({ isLocalMode: () => m.local }));
vi.mock("../migrate", () => ({ migrateCloudToLocal: m.copy }));
vi.mock("../localAuth", () => ({ localWorkspaceOwner: () => m.owner }));
vi.mock("../cloudTransfer", () => ({ withCloudTransfer: async (_c: unknown, _u: string, run: (p: object) => unknown) => run({}) }));
vi.mock("../localdb", () => ({ journalSnapshot: async () => m.journal }));
vi.mock("../sync", () => ({ isMigrating: () => false, setMigrating: vi.fn(), syncCycle: m.cycle, resolveSyncConflicts: vi.fn() }));
vi.mock("../license", () => ({
  entitlement: async () => (m.paid ? "pro" : "free"),
  cloudAccess: async () => ({ allowed: true, reason: "basic" }),
}));

import { deviceCopyAt, deviceCopyInFlight, isMajorChange, runCloudCopy, runDeviceCopy, setCloudCopy } from "../cloudCopy";

const entry = (n: number) => ({ changed: Array.from({ length: n }, (_, i) => i), deleted: [] });

beforeEach(() => {
  m.session = { user: { id: "owner" } };
  m.paid = true;
  m.cycle.mockClear();
  m.journal = { v: 1, tables: {} };
  m.local = true;
  m.owner = "owner";
  m.copy.mockClear();
  setCloudCopy("owner");
});

it("uploads money records at once and lets small edits wait for the 5-minute pass", () => {
  expect(isMajorChange({ invoice_docs: entry(1) })).toBe(true);
  expect(isMajorChange({ crm_notes: entry(3) })).toBe(false);
  expect(isMajorChange({ crm_notes: entry(20), crm_tasks: entry(5) })).toBe(true);
  expect(isMajorChange({ crm_notes: { ...entry(0), all: true } })).toBe(true);
});

it("syncs only for the paid account that turned the copy on", async () => {
  expect(await runCloudCopy(true)).toBe(true);
  expect(m.cycle).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ changesOnly: false }));

  m.cycle.mockClear();
  m.session = { user: { id: "someone-else" } };
  expect(await runCloudCopy(true)).toBe(false);
  m.session = { user: { id: "owner" } };
  m.paid = false;
  expect(await runCloudCopy(true)).toBe(false);
  m.paid = true;
  setCloudCopy(null);
  expect(await runCloudCopy(true)).toBe(false);
  expect(m.cycle).not.toHaveBeenCalled();
});

it("skips the network when a quick pass has nothing to send", async () => {
  expect(await runCloudCopy(false)).toBe(true);
  expect(m.cycle).not.toHaveBeenCalled();
  m.journal.tables.invoice_docs = entry(1);
  await runCloudCopy(false);
  expect(m.cycle).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ changesOnly: true }));
});

it("keeps the desktop copy current in cloud mode without overwriting unsent edits", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  try {
    m.local = false;
    localStorage.removeItem("filey_device_copy_at");
    const first = runDeviceCopy();
    expect(runDeviceCopy()).toBe(first); // a second trigger joins the running copy
    expect(deviceCopyInFlight()).toBeDefined();
    expect(await first).toBe(true);
    expect(m.copy).toHaveBeenCalledOnce();
    expect(deviceCopyAt()).not.toBeNull();
    expect(deviceCopyInFlight()).toBeUndefined();

    m.copy.mockClear();
    m.journal.tables.invoice_docs = entry(1);
    expect(await runDeviceCopy()).toBe(false);
    m.journal.tables = {};
    m.owner = "another-account";
    expect(await runDeviceCopy()).toBe(false);
    m.owner = "owner";
    m.local = true;
    expect(await runDeviceCopy()).toBe(false);
    expect(m.copy).not.toHaveBeenCalled();
  } finally {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  }
});
