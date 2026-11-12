import { afterEach, expect, it, vi } from "vitest";
import { BATCHES_KEY, batchFields, batchStock, expiringBatches, expiryFrom, fefoBatch, onlyExpired, readBatches, receiveBatch, writeOffBatch, type Batch } from "../batches";
import { erp, type Product } from "../api";

afterEach(() => vi.restoreAllMocks());

const TODAY = "2026-11-01";
const A: Batch = { no: "A1", exp: "2026-10-31", qty: 10 };
const B: Batch = { no: "B2", exp: "2027-03-31", qty: 20 };
const C: Batch = { no: "C3", exp: "2026-12-31", qty: 5 };
const product = (quantity: number, batches: Batch[] = [A, B, C]) =>
  ({ id: 7, name: "Paracetamol 500", sku: "P500", quantity, unit_price: 2, cost_price: 1, reorder_level: 0, created_at: "",
    custom_fields: { [BATCHES_KEY]: JSON.stringify(batches), note: "keep" } }) as Product;

it("reads printed expiry formats", () => {
  expect(expiryFrom("03/27")).toBe("2027-03-31");
  expect(expiryFrom("2/2028")).toBe("2028-02-29");
  expect(expiryFrom("2027-06")).toBe("2027-06-30");
  expect(expiryFrom("2027-06-15")).toBe("2027-06-15");
  expect(expiryFrom("13/27")).toBe("");
  expect(expiryFrom("soon")).toBe("");
});

it("takes sold stock from the earliest expiry first", () => {
  // 35 received, 22 on hand: 13 sold → A (10) gone, C down to 2, B untouched.
  const { batches, unbatched } = batchStock([A, B, C], 22, TODAY);
  expect(batches.map((b) => [b.no, b.left])).toEqual([["A1", 0], ["C3", 2], ["B2", 20]]);
  expect(batches[0].expired).toBe(true);
  expect(batches[1].daysLeft).toBe(60);
  expect(unbatched).toBe(0);
  expect(batchStock([A], 15, TODAY).unbatched).toBe(5);
});

it("picks the next in-date batch and spots stock that is only expired", () => {
  expect(fefoBatch(product(35), TODAY)?.no).toBe("C3"); // A1 has stock but is expired
  expect(fefoBatch(product(20), TODAY)?.no).toBe("B2");
  expect(onlyExpired(product(4, [A]), TODAY)).toBe(true);
  expect(onlyExpired(product(4, [B]), TODAY)).toBe(false);
  expect(readBatches({ custom_fields: { [BATCHES_KEY]: "broken" } })).toEqual([]);
});

it("drops used-up batches and keeps the product's own batch and expiry on the next one to sell", () => {
  const fields = batchFields(product(22), [A, B, C], 22, TODAY);
  expect(readBatches(fields).map((b) => [b.no, b.qty])).toEqual([["C3", 2], ["B2", 20]]);
  expect(fields.custom_fields?.note).toBe("keep");
  expect(fields).toMatchObject({ batch_number: "C3", expiry_date: "2026-12-31" });
  // The maths is unchanged after pruning.
  expect(batchStock(readBatches(fields), 22, TODAY).batches.map((b) => b.left)).toEqual([2, 20]);
});

it("lists batches expiring soon across products", () => {
  const list = expiringBatches([product(35)], TODAY, 90);
  expect(list.map((x) => x.batch.no)).toEqual(["A1", "C3"]);
});

it("receives a batch into stock and writes off an expired one", async () => {
  const stock = vi.spyOn(erp, "recordStockEntry").mockResolvedValue(undefined);
  const update = vi.spyOn(erp, "updateProduct").mockResolvedValue(undefined as never);
  await receiveBatch(product(0, []), { no: "D4", exp: "2027-08-31", qty: 50, mrp: 3 }, TODAY);
  expect(stock).toHaveBeenCalledWith(7, "in", 50, "Batch D4", expect.stringContaining("D4"));
  expect(readBatches(update.mock.calls[0][1] as Product)).toEqual([{ no: "D4", exp: "2027-08-31", qty: 50, mrp: 3, received: TODAY }]);

  stock.mockClear(); update.mockClear();
  expect(await writeOffBatch(product(35), "A1", TODAY)).toBe(10);
  expect(stock).toHaveBeenCalledWith(7, "out", 10, "Batch A1", "Expired batch A1 written off");
  expect(readBatches(update.mock.calls[0][1] as Product).map((b) => b.no)).toEqual(["C3", "B2"]);
});
