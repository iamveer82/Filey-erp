import "fake-indexeddb/auto";
import { expect, test, vi } from "vitest";
vi.mock("./nativePlatform", () => ({ isNativeApp: () => true }));
import { readDeviceValue, writeDeviceValues, compareDeviceValues, restoreNativeOwnership } from "./deviceStorage";

test("mobile commits records and journal together, rolls back failures, and preserves legacy data", async () => {
  const prefix = crypto.randomUUID();
  const records = `${prefix}:records`, journal = `${prefix}:journal`;
  localStorage.setItem(records, "legacy records");
  expect(await readDeviceValue(records)).toBe("legacy records");
  expect(localStorage.getItem(records)).toBeNull();
  await writeDeviceValues([[records, "saved records"], [journal, "saved journal"]]);
  // An invalid IndexedDB key after the first put must roll back that first put.
  await expect(writeDeviceValues([[records, "unsaved records"], [null as unknown as string, "invalid"]])).rejects.toThrow();
  expect(await readDeviceValue(records)).toBe("saved records");
  expect(await readDeviceValue(journal)).toBe("saved journal");
  await writeDeviceValues([[records, "x".repeat(6 * 1024 * 1024)]]);
  expect((await readDeviceValue(records))?.length).toBe(6 * 1024 * 1024);
  await writeDeviceValues([[records, null]]);
  localStorage.setItem(records, "stale records");
  expect(await readDeviceValue(records)).toBeNull();
  // Books keep their owning identity even if WebView settings are cleared.
  localStorage.setItem("filey_local_workspace_owner", "original-owner");
  await writeDeviceValues([["localdb:orders", '[{"id":1}]'], ["syncjournal", '{"v":1,"tables":{}}']]);
  localStorage.removeItem("filey_local_workspace_owner");
  await restoreNativeOwnership();
  expect(localStorage.getItem("filey_local_workspace_owner")).toBe("original-owner");
  localStorage.setItem("filey_local_workspace_owner", "another-account");
  await expect(readDeviceValue("localdb:orders")).rejects.toThrow("original account");
  await expect(writeDeviceValues([["localdb:orders", "[]"]])).rejects.toThrow("original account");
  localStorage.setItem("filey_local_workspace_owner", "original-owner");
  expect(await readDeviceValue("localdb:orders")).toBe('[{"id":1}]');
  const originalOrders = await readDeviceValue("localdb:orders");
  const originalJournal = await readDeviceValue("syncjournal");
  await writeDeviceValues([["localdb:orders", '[{"id":1},{"id":2}]'], ["syncjournal", '{"v":2,"tables":{}}']]);
  expect(await compareDeviceValues([["localdb:orders", "[]"], ["syncjournal", '{"v":3,"tables":{}}']],
    [["localdb:orders", originalOrders], ["syncjournal", originalJournal]])).toBe(false);
  expect(await readDeviceValue("localdb:orders")).toBe('[{"id":1},{"id":2}]');
  expect(await readDeviceValue("syncjournal")).toBe('{"v":2,"tables":{}}');
  expect(await compareDeviceValues([["localdb:orders", '[{"id":2}]'], ["syncjournal", '{"v":3,"tables":{"orders":{"deleted":[1],"changed":[2]}}}']],
    [["localdb:orders", '[{"id":1},{"id":2}]'], ["syncjournal", '{"v":2,"tables":{}}']])).toBe(true);
  expect(await readDeviceValue("localdb:orders")).toBe('[{"id":2}]');
  localStorage.setItem("filey_local_workspace_owner", "another-account");
  await expect(compareDeviceValues([["localdb:orders", "[]"]], [["localdb:orders", '[{"id":2}]']])).rejects.toThrow("original account");
  localStorage.setItem("filey_local_workspace_owner", "original-owner");
  expect(await readDeviceValue("localdb:orders")).toBe('[{"id":2}]');
});
