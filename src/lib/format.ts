import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// UAE standard VAT rate (Federal Decree-Law No. 8 of 2017)
export const UAE_VAT_RATE = 0.05;

// Org-wide display currency for dashboards & aggregate figures. Set from the
// company profile, or from the topbar switcher (see lib/displayCurrency).
// Per-document currencies (invoices, quotes) are formatted explicitly with
// money(value, currency).
//
// Aggregates everywhere are computed in AED — every document is converted at
// its own frozen rate first (docAmountInAed) so a $1,000 and a AED 1,000
// invoice don't add up to 2,000 of nothing. `displayRate` is what turns that
// AED figure back into the currency being displayed. Relabelling without
// dividing is the bug this pair exists to prevent: it showed AED amounts
// under a "$" whenever the company currency wasn't AED.
let displayCurrency = "AED";
/** AED per 1 unit of displayCurrency (1 when displaying AED). */
let displayRate = 1;

export function setDisplayCurrency(c?: string | null, aedPerUnit = 1): void {
  displayCurrency = c && c.trim() ? c : "AED";
  displayRate = aedPerUnit > 0 ? aedPerUnit : 1;
}

/** The org's current display currency (synced from the company profile). */
export function getDisplayCurrency(): string {
  return displayCurrency;
}

/** Single source of truth for the currency pickers across the app. */
export const CURRENCIES: { code: string; name: string }[] = [
  { code: "AED", name: "UAE Dirham" },
  { code: "USD", name: "US Dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British Pound" },
  { code: "INR", name: "Indian Rupee" },
  { code: "SAR", name: "Saudi Riyal" },
];

/** Format an AED-denominated value in the org's display currency, converting
 *  on the way. Name kept for history; it is no longer AED-only. */
export function aed(value: number): string {
  return money((value || 0) / displayRate, displayCurrency);
}

export function num(value: number): string {
  return new Intl.NumberFormat("en-AE").format(value || 0);
}

/** Parse a number-input string safely — never returns NaN. */
export function numInput(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/** Format a value in any ISO currency (falls back gracefully). */
export function money(value: number, currency = "AED"): string {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: currency || "AED",
      maximumFractionDigits: 2,
    }).format(value || 0);
  } catch (e) {
    console.warn("Failed to format currency; falling back", e);
    return `${currency} ${(value || 0).toFixed(2)}`;
  }
}

export function vatBreakdown(net: number) {
  const vat = +(net * UAE_VAT_RATE).toFixed(2);
  return { net, vat, gross: +(net + vat).toFixed(2) };
}

/** yyyy-mm-dd of a Date in the USER'S timezone. toISOString() shifts to UTC
 *  first — a local-midnight date picked in Dubai (UTC+4) would land on the
 *  previous day. Use this for anything a date picker hands back. */
export function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** Today's date in the USER'S timezone. `new Date().toISOString().slice(0,10)`
 *  answers "what day is it in UTC", which in Dubai (UTC+4) is yesterday until
 *  4am — long enough to date an invoice, a payment or an attendance row to the
 *  wrong day, and to make "overdue today" comparisons fire a day early. */
export function todayYmd(): string {
  return localYmd(new Date());
}

export function fmtDate(d?: string | null): string {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString("en-AE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Extract a human-readable message from any error shape.
 * Handles Error, Supabase PostgrestError ({message, details, hint}),
 * and plain objects without producing [object Object]. */
export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const obj = e as Record<string, unknown>;
    return String(obj.message ?? obj.details ?? obj.hint ?? JSON.stringify(e));
  }
  return String(e);
}
