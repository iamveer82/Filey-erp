import { beforeEach, expect, it, vi } from "vitest";
import { isTdsMethod, tdsAmount, tdsMethod, withTcs } from "../tds";
import { billing, fin } from "../api";
import type { DocItem } from "../docItems";

vi.mock("../exchange-rates", async (original) => ({
  ...await original<typeof import("../exchange-rates")>(),
  getExchangeRates: async () => ({ AED: 1 }),
}));
beforeEach(() => { localStorage.clear(); localStorage.setItem("filey_data_mode", "local"); });

const line = (unit_price: number, extra: Partial<DocItem> = {}) => ({ description: "x", qty: 1, unit_price, ...extra }) as DocItem;
const balance = async (pattern: RegExp) => Number((await fin.accounts()).find((row) => pattern.test(row.name))?.balance ?? 0);

it("names TDS payment rows and works it out before GST", () => {
  expect(tdsMethod("194J")).toBe("TDS 194J");
  expect(isTdsMethod("TDS 194C")).toBe(true);
  expect(isTdsMethod("bank transfer")).toBe(false);
  expect(tdsAmount(100000, 10)).toBe(10000);
  expect(tdsAmount(54321, 0.1)).toBe(54);
});

it("prices a TCS line at its rate of everything else, GST included", () => {
  const items = [line(1000), line(0, { description: "TCS", custom: { tcs: "1" }, tax_category: "O" })];
  const priced = withTcs(items, 0, 18, null);
  expect(priced[1].unit_price).toBe(11.8);
  expect(priced[0]).toBe(items[0]);
  expect(withTcs(priced, 0, 18, null)[1]).toBe(priced[1]);
  const plain = [line(5)];
  expect(withTcs(plain, 0, 18, null)).toBe(plain);
});

it("settles a sale with TDS kept back: cash shows only what arrived, TDS sits as a credit", async () => {
  const id = await billing.saveDoc({ number: "INV-TDS", status: "sent", currency: "AED", tax_rate: 0, discount: 0, customer_name: "Acme",
    items: [{ description: "Consulting", qty: 1, unit_price: 100 }] } as never);
  await billing.addPayment(id, 90, "bank transfer", "2026-10-01");
  const tdsRow = await billing.addPayment(id, 10, tdsMethod("194J"), "2026-10-01");
  await fin.moveTds(10, false, "2026-10-01", "TDS 194J on invoice INV-TDS");
  expect((await billing.getDoc(id)).status).toBe("paid");
  expect(await balance(/cash|bank/i)).toBe(90);
  expect(await balance(/tds credit/i)).toBe(10);
  expect(await balance(/receivable/i)).toBe(0);

  await billing.removePayment(tdsRow);
  await fin.moveTds(10, false, "2026-10-02", "TDS 194J on invoice INV-TDS", true);
  expect(await balance(/cash|bank/i)).toBe(90);
  expect(await balance(/tds credit/i)).toBe(0);
  expect(await balance(/receivable/i)).toBe(10);
  await expect(fin.moveTds(-5, false, "2026-10-01", "x")).rejects.toThrow("positive TDS");
});
