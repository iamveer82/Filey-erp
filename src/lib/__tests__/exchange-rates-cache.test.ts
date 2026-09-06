// FX rates are money. They get frozen onto an invoice as fx_rate and become the
// AED tax total the FTA requires on a foreign-currency document, so a rate that
// is stale or missing is a wrong number on something a customer and a regulator
// both read.
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { getExchangeRates, unratedCurrency, docAmountInAed } from "../exchange-rates";

// frankfurter is queried with from=EUR and, like most rate APIs, omits the base
// currency from its own rates object.
const apiBody = { rates: { USD: 1.09, AED: 4.0, GBP: 0.85 } };

const mockFetch = (impl: () => Promise<unknown>) => {
  vi.stubGlobal("fetch", vi.fn(impl));
};

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});
afterEach(() => vi.unstubAllGlobals());

describe("live rates", () => {
  it("includes EUR, which the API leaves out of its own response", async () => {
    mockFetch(async () => ({ ok: true, json: async () => apiBody }));

    const rates = await getExchangeRates();

    // 1 EUR = 4.0 AED per the response above.
    expect(rates.EUR).toBeCloseTo(4.0, 6);
    expect(unratedCurrency("EUR", null, rates)).toBe(false);
    expect(docAmountInAed(100, "EUR", null, rates)).toBeCloseTo(400, 6);
  });

  it("still derives the other currencies from the EUR base", async () => {
    mockFetch(async () => ({ ok: true, json: async () => apiBody }));
    const rates = await getExchangeRates();
    expect(rates.AED).toBe(1);
    expect(rates.USD).toBeCloseTo(4.0 / 1.09, 6); // AED per 1 USD
  });
});

describe("a failed fetch", () => {
  it("does not pin the fallback for the full cache lifetime", async () => {
    mockFetch(async () => {
      throw new Error("offline");
    });
    const first = await getExchangeRates();
    expect(first.USD).toBeGreaterThan(0); // fallback served, as it should be

    // Five minutes and one second later the API is reachable again. The old
    // behaviour cached the fallback for four hours, so this returned the
    // hardcoded approximation and never asked.
    const expiry = Number(localStorage.getItem("filey_exchange_rates_ts"));
    const remaining = expiry - Date.now();
    // Must be a real future expiry (the old code stored the write time, which
    // the four-hour window then measured from) and short.
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(5 * 60 * 1000);
  });

  it("comes back for the real rate once the short window passes", async () => {
    mockFetch(async () => {
      throw new Error("offline");
    });
    await getExchangeRates();

    // Expire the fallback entry, then let the API recover.
    localStorage.setItem("filey_exchange_rates_ts", String(Date.now() - 1));
    mockFetch(async () => ({ ok: true, json: async () => apiBody }));

    const rates = await getExchangeRates();
    expect(rates.EUR).toBeCloseTo(4.0, 6); // live, not the hardcoded guess
  });
});

describe("a good fetch", () => {
  it("is cached, and the API is not called again", async () => {
    const fn = vi.fn(async () => ({ ok: true, json: async () => apiBody }));
    vi.stubGlobal("fetch", fn);

    await getExchangeRates();
    await getExchangeRates();

    expect(fn).toHaveBeenCalledTimes(1);
  });
});
