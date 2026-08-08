/**
 * Live exchange rates — fetches from free API, caches in localStorage.
 * Base currency: AED (pegged to USD at 3.6725)
 */

const CACHE_KEY = "filey_exchange_rates";
const CACHE_TIME_KEY = "filey_exchange_rates_ts";
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const AED_TO_USD = 3.6725; // UAE Dirham is pegged to USD

export type Rates = Record<string, number>;

/** Get live exchange rates (AED base). Returns cached if fresh, fetches if stale. */
export async function getExchangeRates(): Promise<Rates> {
  const cached = loadCached();
  if (cached && Object.keys(cached).length > 0) return cached;
  return fetchFresh();
}

/** Force-refresh rates from API. */
export async function refreshRates(): Promise<Rates> {
  return fetchFresh();
}

function loadCached(): Rates | null {
  try {
    const ts = localStorage.getItem(CACHE_TIME_KEY);
    if (!ts) return null;
    const age = Date.now() - Number(ts);
    if (age > CACHE_TTL_MS) return null;
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Rates;
  } catch (e) {
    console.warn("Failed to load cached exchange rates", e);
    return null;
  }
}

function saveCache(rates: Rates): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(rates));
    localStorage.setItem(CACHE_TIME_KEY, String(Date.now()));
  } catch (e) {
    console.warn("Failed to save exchange-rate cache", e);
  }
}

async function fetchFresh(): Promise<Rates> {
  // Try frankfurter.app (free, no key, EUR base)
  // Then convert to AED base using AED pegged rate
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=EUR");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const eurRates: Rates = data.rates as Rates;
    // Convert from EUR base to AED base
    // AED = USD * 3.6725
    // 1 EUR = X USD → 1 EUR = X * 3.6725 AED
    // So AED rate = 1 / (EUR rate in AED)
    if (!eurRates.USD || !eurRates.AED) {
      // Fallback to hardcoded rates
      const fallback = getFallbackRates();
      saveCache(fallback);
      return fallback;
    }
    const eurToAed = eurRates.AED;
    const rates: Rates = {};
    for (const [currency, eurValue] of Object.entries(eurRates)) {
      if (currency === "AED") {
        rates[currency] = 1;
      } else {
        // How much AED per 1 unit of currency
        rates[currency] = eurToAed / (eurValue as number);
      }
    }
    saveCache(rates);
    return rates;
  } catch (e) {
    console.warn("Exchange-rate API failed; using fallback rates", e);
    // API down — use hardcoded fallback
    const fallback = getFallbackRates();
    saveCache(fallback);
    return fallback;
  }
}

/** Hardcoded fallback rates (AED base). Updated periodically. */
function getFallbackRates(): Rates {
  return {
    AED: 1,
    USD: AED_TO_USD,
    EUR: AED_TO_USD * 1.08, // Approximate EUR/USD
    GBP: AED_TO_USD * 1.26,
    INR: AED_TO_USD / 83.5,
    SAR: AED_TO_USD / 3.75,
    PKR: AED_TO_USD / 278,
    QAR: AED_TO_USD / 3.64,
    OMR: AED_TO_USD / 0.385,
    BHD: AED_TO_USD / 0.376,
    KWD: AED_TO_USD / 0.308,
  };
}

/** Convert amount from source currency to AED. */
export function convertToAed(amount: number, fromCurrency: string, rates: Rates): number {
  if (fromCurrency === "AED") return amount;
  const rate = rates[fromCurrency];
  if (!rate || rate <= 0) return amount; // unknown currency — passthrough
  return amount * rate;
}

/** A document's amount in AED, for adding up alongside other documents.
 *
 *  Totals that ignore currency are worse than useless: a $1,000 invoice added
 *  straight onto a AED 1,000 one reads as 2,000 of nothing. Every aggregate
 *  goes through here.
 *
 *  The document's OWN frozen rate wins when it has one — that is the rate that
 *  applied on the day it was issued, which is what the FTA expects and what
 *  keeps last quarter's numbers from moving when today's rate does. Live rates
 *  are only a fallback for documents saved before the freeze existed. */
export function docAmountInAed(
  amount: number,
  currency: string | null | undefined,
  fxRate: number | null | undefined,
  rates: Rates = {}
): number {
  const cur = (currency || "AED").toUpperCase();
  if (cur === "AED") return amount;
  if (fxRate && fxRate > 0) return amount * fxRate;
  return convertToAed(amount, cur, rates);
}

/** True when a document is in a foreign currency we cannot value in AED —
 *  no frozen rate and no live rate. The caller should say so rather than
 *  silently fold the raw number into a total. */
export function unratedCurrency(
  currency: string | null | undefined,
  fxRate: number | null | undefined,
  rates: Rates = {}
): boolean {
  const cur = (currency || "AED").toUpperCase();
  if (cur === "AED") return false;
  if (fxRate && fxRate > 0) return false;
  return !(rates[cur] > 0);
}

/** Convert amount from AED to target currency. */
export function convertFromAed(amount: number, toCurrency: string, rates: Rates): number {
  if (toCurrency === "AED") return amount;
  const rate = rates[toCurrency];
  if (!rate || rate <= 0) return amount;
  return amount / rate;
}

/** Format amount in AED equivalent — shows original + AED conversion. */
export function formatWithRate(
  amount: number,
  sourceCurrency: string,
  rates: Rates
): string {
  if (sourceCurrency === "AED" || !rates[sourceCurrency]) return "";
  const aedValue = convertToAed(amount, sourceCurrency, rates);
  return `≈ AED ${aedValue.toFixed(2)}`;
}
