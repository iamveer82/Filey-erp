import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  paid: true,
  local: true,
  owner: "owner" as string | null,
  push: vi.fn(async (..._args: unknown[]) => true),
  cycle: vi.fn(async (..._args: unknown[]) => true),
  copy: vi.fn(async () => [{ table: "invoice_docs", rows: 1 }] as { table: string; rows: number; error?: string }[]),
  feed: vi.fn(async (..._args: unknown[]) => ({ status: "applied", tables: [] as string[] }) as { status: string; tables?: string[] }),
  due: false,
  journal: { v: 1, tables: {} as Record<string, { changed: unknown[]; deleted: unknown[]; all?: boolean }> },
}));
vi.mock("../supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: m.session } }) } } }));
vi.mock("../dataMode", () => ({ isLocalMode: () => m.local }));
vi.mock("../migrate", () => ({ migrateCloudToLocal: m.copy }));
vi.mock("../localAuth", () => ({ localWorkspaceOwner: () => m.owner }));
vi.mock("../cloudTransfer", () => ({ withCloudTransfer: async (_c: unknown, _u: string, run: (p: object) => unknown) => run({}) }));
vi.mock("../localdb", () => ({ journalSnapshot: async () => m.journal }));
vi.mock("../sync", () => ({ isMigrating: () => false, setMigrating: vi.fn(), syncCycle: m.cycle, syncNow: m.push, resolveSyncConflicts: vi.fn() }));
vi.mock("../changeFeed", () => ({
  pullChanges: m.feed,
  completeCopyDue: () => m.due,
  reconcile: async (_client: unknown, _uid: string, copy: () => Promise<boolean>) => copy(),
}));
vi.mock("../license", () => ({
  entitlement: async () => (m.paid ? "pro" : "free"),
  cloudAccess: async () => ({ allowed: true, reason: "basic" }),
}));

import {
  deviceCopyAt, deviceCopyInFlight, downloadChanges, isMajorChange, runDeviceCopy, setCloudCopy, uploadChanges, uploadDelay,
} from "../cloudCopy";

const entry = (n: number) => ({ changed: Array.from({ length: n }, (_, i) => i), deleted: [] });

beforeEach(() => {
  m.session = { user: { id: "owner" } };
  m.paid = true;
  m.local = true;
  m.owner = "owner";
  m.due = false;
  m.journal = { v: 1, tables: {} };
  for (const fn of [m.push, m.cycle, m.copy, m.feed]) fn.mockClear();
  m.feed.mockResolvedValue({ status: "applied", tables: [] });
  setCloudCopy("owner");
});
afterEach(() => Reflect.deleteProperty(window, "__TAURI_INTERNALS__"));

it("uploads money records within 15–20 seconds and other edits within minutes", () => {
  expect(isMajorChange({ invoice_docs: entry(1) })).toBe(true);
  expect(isMajorChange({ crm_notes: entry(3) })).toBe(false);
  expect(isMajorChange({ crm_notes: entry(20), crm_tasks: entry(5) })).toBe(true);
  expect(uploadDelay(true, 0, 0)).toBe(15_000);
  expect(uploadDelay(true, 10_000, 0)).toBe(10_000); // first unsent change 10 s ago: still within 20 s
  expect(uploadDelay(false, 0, 0)).toBe(120_000);
  expect(uploadDelay(false, 240_000, 0)).toBe(60_000);
});

it("sends only this device's changes, and only for the paid account that turned the copy on", async () => {
  expect(await uploadChanges()).toBe(true);
  expect(m.push).not.toHaveBeenCalled(); // nothing unsent: no request at all
  m.journal.tables.invoice_docs = entry(1);
  await uploadChanges();
  expect(m.push).toHaveBeenCalledOnce();
  expect(m.cycle).not.toHaveBeenCalled(); // no whole-account pass on a save

  m.push.mockClear();
  m.session = { user: { id: "someone-else" } };
  expect(await uploadChanges()).toBe(false);
  m.session = { user: { id: "owner" } };
  m.paid = false;
  expect(await uploadChanges()).toBe(false);
  m.paid = true;
  setCloudCopy(null);
  expect(await uploadChanges()).toBe(false);
  expect(m.push).not.toHaveBeenCalled();
});

it("downloads through the change feed and copies everything only when it must", async () => {
  const refreshed = vi.fn();
  window.addEventListener("filey:remote-update", refreshed);
  try {
    m.feed.mockResolvedValueOnce({ status: "applied", tables: ["invoice_docs"] });
    expect(await downloadChanges()).toBe(true);
    expect(m.feed).toHaveBeenCalledWith(expect.anything(), "owner", { keepUnsent: true });
    expect(m.cycle).not.toHaveBeenCalled();
    expect(refreshed).toHaveBeenCalledOnce();

    m.feed.mockResolvedValueOnce({ status: "reconcile" });
    expect(await downloadChanges()).toBe(true);
    expect(m.cycle).toHaveBeenCalledOnce();

    m.feed.mockClear();
    expect(await downloadChanges(true)).toBe(true); // turning the copy on: one complete pass
    expect(m.feed).not.toHaveBeenCalled();
    expect(m.cycle).toHaveBeenCalledTimes(2);

    m.feed.mockResolvedValueOnce({ status: "busy" });
    expect(await downloadChanges()).toBe(false);
  } finally {
    window.removeEventListener("filey:remote-update", refreshed);
  }
});

it("keeps the desktop copy current in cloud mode from the feed, without overwriting unsent edits", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  m.local = false;
  localStorage.removeItem("filey_device_copy_at");
  const first = runDeviceCopy();
  expect(runDeviceCopy()).toBe(first); // a second trigger joins the running copy
  expect(deviceCopyInFlight()).toBeDefined();
  expect(await first).toBe(true);
  expect(m.feed).toHaveBeenCalledWith(expect.anything(), "owner", { keepUnsent: false });
  expect(m.copy).not.toHaveBeenCalled();
  expect(deviceCopyAt()).not.toBeNull();
  expect(deviceCopyInFlight()).toBeUndefined();

  m.feed.mockResolvedValueOnce({ status: "reconcile" });
  expect(await runDeviceCopy()).toBe(true);
  expect(m.copy).toHaveBeenCalledOnce();

  m.feed.mockClear();
  m.journal.tables.invoice_docs = entry(1);
  expect(await runDeviceCopy()).toBe(false);
  m.journal.tables = {};
  m.owner = "another-account";
  expect(await runDeviceCopy()).toBe(false);
  expect(m.feed).not.toHaveBeenCalled();
});
