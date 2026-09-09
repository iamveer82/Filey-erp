import { docAmountInAed, unratedCurrency, type Rates } from "./exchange-rates";

/** Reporting copies only: original documents and their currencies are untouched. */
export function reportMoney<
  T extends { currency?: string | null; fx_rate?: number | null },
>(row: T, keys: readonly string[], rates: Rates): T {
  if (unratedCurrency(row.currency, row.fx_rate, rates))
    throw new Error(
      `No AED exchange rate is available for ${row.currency}. Set the document's rate before including it in financial reports.`
    );
  const factor = docAmountInAed(1, row.currency, row.fx_rate, rates);
  if (!Number.isFinite(factor) || factor <= 0)
    throw new Error("Invalid reporting exchange rate.");
  const copy = { ...row } as Record<string, unknown>;
  for (const key of keys) {
    if (copy[key] == null) continue;
    const value = Number(copy[key]);
    if (!Number.isFinite(value)) throw new Error(`Invalid ${key} in reporting data.`);
    copy[key] = value * factor;
  }
  if (copy.net_by_tax_category && typeof copy.net_by_tax_category === "object")
    copy.net_by_tax_category = Object.fromEntries(
      Object.entries(copy.net_by_tax_category).map(([key, value]) => [
        key,
        Number(value) * factor,
      ])
    );
  return { ...copy, currency: "AED", fx_rate: 1 } as T;
}
