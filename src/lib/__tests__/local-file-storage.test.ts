import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ values: new Map<string, string>(), disk: new Map<string, number[]>(), denied: false }));
const invoke = vi.hoisted(() => vi.fn(async (command: string, args: { key?: string; value?: string; path?: string; bytes?: number[] }) => {
  if (command === "cache_get") return state.values.get(args.key!) ?? null;
  if (command === "cache_set") { state.values.set(args.key!, args.value!); return; }
  if (command === "blob_read") return state.disk.get(args.path!) ?? null;
  if (command === "blob_write") { state.disk.set(args.path!, args.bytes!); return; }
  if (command === "blob_delete") {
    if (state.denied) throw new Error("Disk access denied");
    state.disk.delete(args.path!);
  }
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

beforeEach(() => {
  state.values.clear(); state.disk.clear(); state.denied = false; invoke.mockClear();
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  vi.resetModules();
});
afterEach(() => { Reflect.deleteProperty(window, "__TAURI_INTERNALS__"); });

it("reports a rejected native deletion and preserves its legacy bytes for retry", async () => {
  const { localClient } = await import("../localdb");
  const path = "owner/file-one/invoice.pdf";
  const legacy = JSON.stringify({ mime: "application/pdf", b64: btoa("private PDF") });
  state.values.set(`fileblob:${path}`, legacy);
  state.disk.set(path, [1, 2, 3]);
  state.denied = true;
  await expect(localClient.storage.from("files").remove([path])).rejects.toThrow("Disk access denied");
  expect(state.disk.get(path)).toEqual([1, 2, 3]);
  expect(state.values.get(`fileblob:${path}`)).toBe(legacy);
  state.denied = false;
  await localClient.storage.from("files").remove([path]);
  expect(state.disk.has(path)).toBe(false);
  expect(state.values.get(`fileblob:${path}`)).toBe("");
});

it("does not resurrect an unmigrated base64 file after its deletion", async () => {
  const { localClient, readBlobBytes } = await import("../localdb");
  const path = "owner/file-one/invoice.pdf";
  state.values.set(`fileblob:${path}`, JSON.stringify({ mime: "application/pdf", b64: btoa("private PDF") }));
  await localClient.storage.from("files").remove([path]);
  expect(await readBlobBytes(path)).toBeNull();
  expect(invoke.mock.calls.some(([command]) => command === "blob_write")).toBe(false);
});

it.each(["{broken", "null", '{"b64":42}', "[]"])("preserves corrupt legacy bytes instead of reporting a missing file: %s", async (raw) => {
  const { readBlobBytes } = await import("../localdb");
  const path = "owner/file-one/invoice.pdf";
  state.values.set(`fileblob:${path}`, raw);
  await expect(readBlobBytes(path)).rejects.toThrow("stored data has been preserved");
  expect(state.values.get(`fileblob:${path}`)).toBe(raw);
  expect(invoke.mock.calls.some(([command]) => ["blob_write", "cache_set"].includes(command))).toBe(false);
});
