import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";

const cloud = vi.hoisted(() => ({ rpc: vi.fn(), changed: vi.fn() }));
vi.mock("../realtime", () => ({ notifyDataChanged: cloud.changed }));
vi.mock("../supabase", async () => {
  const { localClient } = await import("../localdb");
  const { isLocalMode } = await import("../dataMode");
  return { isConfigured: true, supabase: null, sb: () => isLocalMode() ? localClient : { rpc: cloud.rpc } };
});

import { erp, setCacheOrg, StocktakeChangedError } from "../api";
import { journalSnapshot, localClient } from "../localdb";

const request = "a35c75d0-5d37-441e-b9b1-123456789abc";
const rows = async (table: string) => (await localClient.from(table).select("*")).data;
const quantity = async () => Number((await rows("products"))[0].quantity);
beforeEach(async () => {
  localStorage.clear(); localStorage.setItem("filey_data_mode", "local");
  setCacheOrg(null); setCacheOrg("org", "alice");
  cloud.rpc.mockReset(); cloud.changed.mockClear();
  await localClient.from("products").insert({ id: 1, name: "Widget", quantity: 10 });
});
afterEach(() => vi.restoreAllMocks());

it("confirms concurrent/repeated counts once, preserving later stock changes", async () => {
  expect(await Promise.all([erp.recordStocktake(1, 7.125, 10, request), erp.recordStocktake(1, 7.125, 10, request.toUpperCase())]))
    .toEqual([7.125, 7.125]);
  expect(await quantity()).toBe(7.125);
  expect((await rows("stock_movements")).map((row: { qty: number }) => row.qty)).toEqual([-2.875]);
  await erp.updateStock(1, 2);
  expect(await erp.recordStocktake(1, 7.125, 10, request)).toBe(7.125);
  expect(await quantity()).toBe(9.125);
  expect(await rows("stock_movements")).toHaveLength(2);
  expect(await rows("local_stocktake_requests")).toHaveLength(1);
  expect((await journalSnapshot()).tables).not.toHaveProperty("local_stocktake_requests");
});

it("rejects nonce reuse with a different payload and stale counts without changing stock", async () => {
  await erp.recordStocktake(1, 7, 10, request);
  const before = await journalSnapshot();
  await expect(erp.recordStocktake(1, 6, 10, request)).rejects.toThrow("already used for a different count");
  await expect(erp.recordStocktake(1, 8, 10, "b35c75d0-5d37-441e-b9b1-123456789abc")).rejects.toBeInstanceOf(StocktakeChangedError);
  expect(await quantity()).toBe(7);
  expect(await rows("stock_movements")).toHaveLength(1);
  expect(await rows("local_stocktake_requests")).toHaveLength(1);
  expect(await journalSnapshot()).toEqual(before);
});

it("records fractional counts against negative book stock and receipts for unchanged counts", async () => {
  await localClient.from("products").update({ quantity: -0.75 }).eq("id", 1);
  await erp.recordStocktake(1, 0.125, -0.75, request);
  expect(await quantity()).toBe(0.125);
  expect((await rows("stock_movements"))[0].qty).toBe(0.875);
  await erp.recordStocktake(1, 0.125, 0.125, "b35c75d0-5d37-441e-b9b1-123456789abc");
  expect(await rows("stock_movements")).toHaveLength(1);
  expect(await rows("local_stocktake_requests")).toHaveLength(2);
});

it.each([
  [1, -1, 10, request], [1, NaN, 10, request], [1, Infinity, 10, request],
  [1, 0.0001, 10, request], [1, 1, 10.0001, request],
  [1, 100000000000, 10, request], [1, 1, -100000000000, request],
  [1, 99999999999, -2, request], [0, 1, 10, request], [1, 1, 10, "invalid"],
])("rejects invalid count input (%s, %s, %s, %s) before cloud or local writes", async (id, counted, expected, nonce) => {
  localStorage.setItem("filey_data_mode", "cloud");
  await expect(erp.recordStocktake(Number(id), Number(counted), Number(expected), String(nonce))).rejects.toThrow("valid physical quantity");
  expect(cloud.rpc).not.toHaveBeenCalled();
  expect(await quantity()).toBe(10);
  expect(await rows("stock_movements")).toEqual([]);
});

it("rolls quantity, movement and receipt back together if receipt persistence fails", async () => {
  const before = await journalSnapshot();
  const original = Storage.prototype.setItem;
  let failed = false;
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key === "localdb:local_stocktake_requests" && !failed) { failed = true; throw new Error("Disk full"); }
    original.call(this, key, value);
  });
  await expect(erp.recordStocktake(1, 7, 10, request)).rejects.toThrow("Disk full");
  write.mockRestore();
  expect(await quantity()).toBe(10);
  expect(await rows("stock_movements")).toEqual([]);
  expect(await rows("local_stocktake_requests")).toEqual([]);
  expect(await journalSnapshot()).toEqual(before);
  await erp.recordStocktake(1, 7, 10, request);
  expect(await quantity()).toBe(7);
  expect(await rows("stock_movements")).toHaveLength(1);
});

it("stops a pending local count when the workspace changes before its writes", async () => {
  const original = Storage.prototype.getItem;
  const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key) {
    const value = original.call(this, key);
    if (key === "localdb:local_stocktake_requests") setCacheOrg("other-org", "alice");
    return value;
  });
  await expect(erp.recordStocktake(1, 7, 10, request)).rejects.toThrow("workspace changed");
  read.mockRestore();
  expect(await quantity()).toBe(10);
  expect(await rows("stock_movements")).toEqual([]);
  expect(await rows("local_stocktake_requests")).toEqual([]);
});

it("uses only the atomic cloud RPC, with no delta fallback when it is missing or unconfirmed", async () => {
  localStorage.setItem("filey_data_mode", "cloud");
  cloud.rpc.mockResolvedValueOnce({ data: "7.125", error: null });
  expect(await erp.recordStocktake(1, 7.125, 10, request)).toBe(7.125);
  expect(cloud.rpc).toHaveBeenLastCalledWith("filey_record_stocktake", {
    p_id: 1, p_counted: 7.125, p_expected: 10, p_request: request,
  });
  cloud.changed.mockClear();
  cloud.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "RPC absent" } });
  await expect(erp.recordStocktake(1, 7.125, 10, request)).rejects.toThrow("latest cloud database update");
  cloud.rpc.mockResolvedValueOnce({ data: null, error: null });
  await expect(erp.recordStocktake(1, 7.125, 10, request)).rejects.toThrow("could not be confirmed");
  cloud.rpc.mockRejectedValueOnce(new Error("Response lost"));
  await expect(erp.recordStocktake(1, 7.125, 10, request)).rejects.toThrow("Response lost");
  expect(cloud.changed).not.toHaveBeenCalled();
  expect(cloud.rpc).toHaveBeenCalledTimes(4);
  expect(await quantity()).toBe(10);
});

it("marks a confirmed cloud count rejection separately from an uncertain response", async () => {
  localStorage.setItem("filey_data_mode", "cloud");
  cloud.rpc.mockResolvedValueOnce({ data: null, error: { code: "40001", message: "Stock changed" } });
  await expect(erp.recordStocktake(1, 7, 10, request)).rejects.toBeInstanceOf(StocktakeChangedError);
  cloud.rpc.mockRejectedValueOnce(new Error("Request timed out"));
  await expect(erp.recordStocktake(1, 7, 10, request)).rejects.not.toBeInstanceOf(StocktakeChangedError);
});

it("rejects a cloud acknowledgement that arrives after a workspace switch", async () => {
  localStorage.setItem("filey_data_mode", "cloud");
  let release!: (value: unknown) => void;
  cloud.rpc.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const saving = erp.recordStocktake(1, 7, 10, request);
  const rejection = expect(saving).rejects.toThrow("workspace changed");
  await waitFor(() => expect(cloud.rpc).toHaveBeenCalledOnce());
  setCacheOrg("other-org", "alice");
  release({ data: 7, error: null });
  await rejection;
  expect(cloud.changed).not.toHaveBeenCalled();
});
