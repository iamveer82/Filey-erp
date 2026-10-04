import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("./nativePlatform", () => ({ isNativeApp: () => false }));

type DeviceStorage = typeof import("./deviceStorage");
let storage: DeviceStorage;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
  localStorage.setItem("filey_local_workspace_owner", "original-owner");
  vi.stubGlobal("indexedDB", new IDBFactory());
  storage = await import("./deviceStorage");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function limitStorage(bytes: number): void {
  const original = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
    let used = (key.length + value.length) * 2;
    for (let index = 0; index < this.length; index++) {
      const savedKey = this.key(index)!;
      if (savedKey !== key) used += (savedKey.length + this.getItem(savedKey)!.length) * 2;
    }
    if (used > bytes) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    original.call(this, key, value);
  });
}

async function persisted(key: string): Promise<unknown> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("filey-browser-device", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("values", "readonly").objectStore("values").get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

it("keeps ordinary browser storage compatible until a real quota failure", async () => {
  await storage.writeDeviceValues([["localdb:orders", "orders"], ["syncjournal", "journal"]]);
  expect(localStorage.getItem("localdb:orders")).toBe("orders");
  expect(await storage.readDeviceValue("syncjournal")).toBe("journal");
  expect(await persisted("filey:browser-backend")).toBeUndefined();
  await storage.writeDeviceValue("localdb:orders", null);
  expect(localStorage.getItem("localdb:orders")).toBeNull();
});

it("retains legacy behavior without IndexedDB and preserves data if its quota is exhausted", async () => {
  vi.stubGlobal("indexedDB", undefined);
  await storage.writeDeviceValues([["localdb:orders", "old orders"], ["syncjournal", "old journal"]]);
  expect(await storage.readDeviceValue("localdb:orders")).toBe("old orders");
  limitStorage(1024);
  await expect(storage.writeDeviceValues([["localdb:orders", "changed orders"], ["syncjournal", "x".repeat(2048)]]))
    .rejects.toThrow("Browser storage is full and IndexedDB is unavailable");
  expect(await storage.readDeviceValue("localdb:orders")).toBe("old orders");
  expect(await storage.readDeviceValue("syncjournal")).toBe("old journal");
});

it("still detects offline books after overflow migration", async () => {
  localStorage.setItem("localdb:crm_tasks", JSON.stringify([{ id: 1, title: "Keep local data" }]));
  limitStorage(1024);
  await storage.writeDeviceValue("cache:fixture", "x".repeat(2048));
  expect(localStorage.getItem("localdb:crm_tasks")).toBeNull();
  const { hasLocalData } = await import("./license");
  expect(await hasLocalData()).toBe(true);
});

it("atomically recovers a full browser, preserving every managed prefix and other preferences", async () => {
  const saved = new Map([
    ["localdb:orders", "old orders"], ["localdb:blob:logo", "retained logo"],
    ["fileblob:invoice.pdf", "retained file"], ["syncjournal", "old journal"],
    ["cache:org:user:one:company", "old cloud cache"], ["outbox", "pending outbox"],
    ["business-workflow:cloud:org:user:one", "pending request"],
  ]);
  for (const [key, value] of saved) localStorage.setItem(key, value);
  localStorage.setItem("filey_local_workspace_owner", "local-owner");
  localStorage.setItem("filey_data_mode", "cloud");
  localStorage.setItem("sb-fixture-auth-token", "private session");
  localStorage.setItem("filey.agent.chats", "retained chats");
  limitStorage(5 * 1024 * 1024);
  const large = "x".repeat(6 * 1024 * 1024);
  await storage.writeDeviceValue("localdb:local_business_workflow_pending", large);
  expect(await storage.readDeviceValue("localdb:local_business_workflow_pending")).toBe(large);
  for (const [key, value] of saved) {
    expect(await storage.readDeviceValue(key)).toBe(value);
    expect(localStorage.getItem(key)).toBeNull();
  }
  expect(await persisted("filey:browser-backend")).toBe("indexeddb-v1");
  expect(localStorage.getItem("filey_local_workspace_owner")).toBe("local-owner");
  expect(localStorage.getItem("filey_data_mode")).toBe("cloud");
  expect(localStorage.getItem("sb-fixture-auth-token")).toBe("private session");
  expect(localStorage.getItem("filey.agent.chats")).toBe("retained chats");
  expect(await persisted("sb-fixture-auth-token")).toBeUndefined();
  // Browser cloud workflow caches retain browser ownership behavior.
  localStorage.setItem("filey_local_workspace_owner", "different-owner");
  await storage.writeDeviceValue("localdb:local_business_workflow_pending", "cloud request");
  expect(await storage.readDeviceValue("localdb:local_business_workflow_pending")).toBe("cloud request");
});

it("keeps the durable backend and tombstones across reloads and cleared local preferences", async () => {
  localStorage.setItem("localdb:orders", "old orders");
  limitStorage(1024);
  await storage.writeDeviceValue("cache:fixture", "x".repeat(2048));
  await storage.writeDeviceValue("localdb:orders", null);
  localStorage.setItem("localdb:orders", "stale legacy orders");
  expect(await storage.readDeviceValue("localdb:orders")).toBeNull();
  vi.resetModules();
  const anotherWindow = await import("./deviceStorage");
  expect(await anotherWindow.readDeviceValue("localdb:orders")).toBeNull();
  localStorage.clear();
  expect(await anotherWindow.readDeviceValue("cache:fixture")).toBe("x".repeat(2048));
  await anotherWindow.writeDeviceValue("localdb:new", "new record");
  expect(localStorage.getItem("localdb:new")).toBeNull();
  expect(await storage.readDeviceValue("localdb:new")).toBe("new record");
});

it("restores migrated book ownership after cleared preferences and rejects another local owner", async () => {
  localStorage.setItem("localdb:orders", "private original orders");
  limitStorage(1024);
  await storage.writeDeviceValue("cache:fixture", "x".repeat(2048));
  expect(await persisted("filey:device-owner")).toBe("original-owner");
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
  await storage.restoreNativeOwnership();
  expect(localStorage.getItem("filey_local_workspace_owner")).toBe("original-owner");
  expect(await storage.readDeviceValue("localdb:orders")).toBe("private original orders");
  localStorage.setItem("filey_local_workspace_owner", "different-account");
  await expect(storage.restoreNativeOwnership()).rejects.toThrow("original account");
  await expect(storage.readDeviceValue("localdb:orders")).rejects.toThrow("original account");
  await expect(storage.writeDeviceValue("localdb:orders", "replacement")).rejects.toThrow("original account");
  await expect(storage.compareDeviceValues([["localdb:orders", "replacement"]],
    [["localdb:orders", "private original orders"]])).rejects.toThrow("original account");
  // A different cloud account may still use its scoped workflow cache.
  localStorage.setItem("filey_data_mode", "cloud");
  await storage.writeDeviceValue("localdb:local_business_workflow_pending", "different cloud account registry");
  expect(await storage.readDeviceValue("localdb:local_business_workflow_pending")).toBe("different cloud account registry");
  await storage.restoreNativeOwnership();
  expect(localStorage.getItem("filey_local_workspace_owner")).toBe("original-owner");
  expect(await persisted("localdb:orders")).toBe("private original orders");
});

it("recovers ownerless cloud bookkeeping and binds an owner only when new local books are saved", async () => {
  localStorage.removeItem("filey_local_workspace_owner");
  localStorage.setItem("filey_data_mode", "cloud");
  localStorage.setItem("localdb:local_business_workflow_pending", "cloud registry");
  localStorage.setItem("localdb:blob:cloud-logo", "cloud logo");
  limitStorage(1024);
  await storage.writeDeviceValue("localdb:local_business_workflow_pending", "x".repeat(2048));
  await storage.restoreNativeOwnership();
  expect(await persisted("filey:device-owner")).toBeUndefined();
  expect(await storage.readDeviceValue("localdb:blob:cloud-logo")).toBe("cloud logo");
  localStorage.setItem("filey_data_mode", "local");
  await expect(storage.writeDeviceValue("localdb:orders", "new orders")).rejects.toThrow("Sign in");
  localStorage.setItem("filey_local_workspace_owner", "first-local-owner");
  // A rejected CAS must not publish an ownership change either.
  expect(await storage.compareDeviceValues([["localdb:orders", "new orders"]],
    [["localdb:orders", "stale orders"]])).toBe(false);
  expect(await persisted("filey:device-owner")).toBeUndefined();
  await storage.writeDeviceValue("localdb:orders", "new orders");
  expect(await persisted("filey:device-owner")).toBe("first-local-owner");
  localStorage.setItem("filey_local_workspace_owner", "another-owner");
  await expect(storage.readDeviceValue("localdb:orders")).rejects.toThrow("original account");
});

it("preserves unowned legacy books and prevents a later account from adopting them", async () => {
  localStorage.removeItem("filey_local_workspace_owner");
  localStorage.setItem("filey_data_mode", "cloud");
  localStorage.setItem("localdb:invoice_docs", "unowned original invoice");
  limitStorage(1024);
  await expect(storage.writeDeviceValue("localdb:local_business_workflow_pending", "x".repeat(2048)))
    .rejects.toThrow("original owner");
  expect(await persisted("filey:browser-backend")).toBe("indexeddb-v1");
  expect(await persisted("filey:device-owner")).toBeNull();
  expect(await persisted("localdb:invoice_docs")).toBe("unowned original invoice");
  expect(await persisted("localdb:local_business_workflow_pending")).toBeNull();
  // Cloud can still render and store its scoped internal bookkeeping.
  await storage.restoreNativeOwnership();
  await storage.writeDeviceValue("localdb:local_business_workflow_pending", "new cloud bookkeeping");
  localStorage.setItem("filey_local_workspace_owner", "new-account");
  localStorage.setItem("filey_data_mode", "local");
  await expect(storage.restoreNativeOwnership()).rejects.toThrow("original owner");
  await expect(storage.readDeviceValue("localdb:invoice_docs")).rejects.toThrow("original owner");
  await expect(storage.writeDeviceValue("localdb:invoice_docs", "replacement invoice")).rejects.toThrow("original owner");
  await expect(storage.compareDeviceValues([["localdb:invoice_docs", "replacement invoice"]],
    [["localdb:invoice_docs", "unowned original invoice"]])).rejects.toThrow("original owner");
  expect(await persisted("localdb:invoice_docs")).toBe("unowned original invoice");
});

it("preserves the original read set when quota recovery happens during a records/journal CAS", async () => {
  localStorage.setItem("localdb:orders", "old orders");
  localStorage.setItem("syncjournal", "old journal");
  limitStorage(1024);
  expect(await storage.compareDeviceValues([["localdb:orders", "x".repeat(2048)]],
    [["localdb:orders", "stale orders"]])).toBe(false);
  expect(await persisted("filey:browser-backend")).toBeUndefined();
  const next = "x".repeat(2048);
  expect(await storage.compareDeviceValues([["localdb:orders", next], ["syncjournal", "new journal"]],
    [["localdb:orders", "old orders"], ["syncjournal", "old journal"]])).toBe(true);
  expect(await storage.readDeviceValue("localdb:orders")).toBe(next);
  expect(await storage.readDeviceValue("syncjournal")).toBe("new journal");
  // Expected values read before a blob triggered migration still match afterward.
  expect(await storage.compareDeviceValues([["localdb:orders", "saved orders"], ["syncjournal", null]],
    [["localdb:orders", next], ["syncjournal", "new journal"]])).toBe(true);
  expect(await storage.compareDeviceValues([["localdb:orders", "lost update"]],
    [["localdb:orders", next], ["syncjournal", "new journal"]])).toBe(false);
  expect(await storage.readDeviceValue("localdb:orders")).toBe("saved orders");
  expect(await storage.readDeviceValue("syncjournal")).toBeNull();
});

it("aborts a failed migrated multi-key write without exposing partial records", async () => {
  limitStorage(1024);
  await storage.writeDeviceValues([["localdb:orders", "x".repeat(2048)], ["syncjournal", "saved journal"]]);
  await expect(storage.writeDeviceValues([["syncjournal", "unsaved journal"], [null as unknown as string, "invalid"]])).rejects.toThrow();
  expect(await storage.readDeviceValue("syncjournal")).toBe("saved journal");
});

it("propagates non-quota storage failures and rolls back staged legacy keys", async () => {
  localStorage.setItem("localdb:orders", "old orders");
  localStorage.setItem("syncjournal", "old journal");
  const original = Storage.prototype.setItem;
  const unavailable = new Error("Device I/O failed");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key === "syncjournal" && value === "new journal") throw unavailable;
    original.call(this, key, value);
  });
  await expect(storage.writeDeviceValues([["localdb:orders", "new orders"], ["syncjournal", "new journal"]])).rejects.toBe(unavailable);
  expect(localStorage.getItem("localdb:orders")).toBe("old orders");
  expect(localStorage.getItem("syncjournal")).toBe("old journal");
  expect(await persisted("filey:browser-backend")).toBeUndefined();
});

it("preserves all legacy data and publishes no backend marker if the migration fails", async () => {
  localStorage.setItem("localdb:orders", "old orders");
  localStorage.setItem("syncjournal", "old journal");
  limitStorage(1024);
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
    if (key === "filey:browser-backend") throw new DOMException("Storage refused the migration", "QuotaExceededError");
    return put.call(this, value, key);
  });
  await expect(storage.writeDeviceValues([["localdb:orders", "changed orders"], ["syncjournal", "x".repeat(2048)]])).rejects.toThrow();
  expect(localStorage.getItem("localdb:orders")).toBe("old orders");
  expect(localStorage.getItem("syncjournal")).toBe("old journal");
  expect(await persisted("filey:browser-backend")).toBeUndefined();
  expect(await persisted("localdb:orders")).toBeUndefined();
  expect(await storage.readDeviceValue("localdb:orders")).toBe("old orders");
});

it("uses localdb's Web Lock without reacquiring it from CAS or dehydration", async () => {
  let held = false;
  const request = vi.fn(async (_name: string, run: () => Promise<unknown>) => {
    if (held) throw new Error("Nested Web Lock would deadlock");
    held = true;
    try { return await run(); } finally { held = false; }
  });
  vi.stubGlobal("navigator", { locks: { request } });
  localStorage.setItem("localdb:orders", "old orders");
  limitStorage(1024);
  await request("filey:local-data", async () => {
    await storage.writeDeviceValue("localdb:blob:logo", "x".repeat(2048), { lockHeld: true });
    expect(await storage.compareDeviceValues([["localdb:orders", "saved orders"]],
      [["localdb:orders", "old orders"]])).toBe(true);
  });
  expect(request).toHaveBeenCalledTimes(1);
  await storage.writeDeviceValue("cache:fixture", "saved cache");
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls.every(([name]) => name === "filey:local-data")).toBe(true);
});
