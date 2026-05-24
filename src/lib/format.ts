import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// UAE standard VAT rate (Federal Decree-Law No. 8 of 2017)
export const UAE_VAT_RATE = 0.05;

// Org-wide display currency for dashboards & aggregate figures. Set from
// the company profile (see setDisplayCurrency). Per-document currencies
// (invoices, quotes) are formatted explicitly with money(value, currency).
let displayCurrency = "AED";

export function setDisplayCurrency(c?: string | null): void {
  displayCurrency = c && c.trim() ? c : "AED";
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

/** Format a value in the org's display currency. Name kept for history;
 *  it is no longer AED-only. */
export function aed(value: number): string {
  return money(value, displayCurrency);
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
  } catch {
    return `${currency} ${(value || 0).toFixed(2)}`;
  }
}

export function vatBreakdown(net: number) {
  const vat = +(net * UAE_VAT_RATE).toFixed(2);
  return { net, vat, gross: +(net + vat).toFixed(2) };
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
