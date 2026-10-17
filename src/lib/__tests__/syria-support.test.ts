import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { COUNTRY_OPTIONS, defaultTaxRate, taxRegimeFor } from "../taxRegimes";
import { companyCountry, companyCountryCurrency, subdivisionLabel } from "../companyCountry";
import { AED_TO_USD, docAmountInAed, getExchangeRates, setManualRate } from "../exchange-rates";
import { CURRENCIES } from "../format";

// Syria: no VAT; sales tax rates depend on the item, and no rate service quotes the new pound.
const apiBody = Object.entries({ USD: 1.09, AED: 4.0 }).map(([quote, rate]) => ({ base: "EUR", quote, rate, date: "2026-10-17" }));
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => apiBody })));
});
afterEach(() => vi.unstubAllGlobals());

it("offers Syria with its sales tax, pound, governorates and no assumed rate", () => {
  expect(COUNTRY_OPTIONS).toContainEqual({ value: "SY", label: "Syria" });
  expect(CURRENCIES).toContainEqual({ code: "SYP", name: "Syrian Pound" });
  expect(taxRegimeFor(null, "SY")).toMatchObject({ taxLabel: "Sales tax", trnLabel: "Tax No.", rates: [0, 5, 10, 15] });
  expect(taxRegimeFor("SYP", null).id).toBe("sy-sales-tax");
  expect(defaultTaxRate("SYP", null, "SY")).toBe(0);
  expect(defaultTaxRate("SYP", 5, "SY")).toBe(5);
  expect(companyCountryCurrency("SY")).toBe("SYP");
  expect(companyCountry({ country_code: null, currency: "SYP" } as never)).toBe("SY");
  expect(subdivisionLabel("SY")).toBe("Governorate");
});

it("values Syrian pound documents at the business's own rate without overriding live ones", async () => {
  expect((await getExchangeRates()).SYP).toBeUndefined();
  setManualRate("SYP", AED_TO_USD / 110); // 110 new pounds per US dollar
  const rates = await getExchangeRates();
  expect(docAmountInAed(11_000, "SYP", null, rates)).toBeCloseTo(367.25, 2);
  expect(rates.AED).toBe(1);
  setManualRate("AED", 99);
  expect((await getExchangeRates()).AED).toBe(1);
  setManualRate("SYP", null);
  expect((await getExchangeRates()).SYP).toBeUndefined();
});
