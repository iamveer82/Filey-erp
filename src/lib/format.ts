import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// UAE standard VAT rate (Federal Decree-Law No. 8 of 2017)
export const UAE_VAT_RATE = 0.05;

export function aed(value: number): string {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 2,
  }).format(value || 0);
}

export function num(value: number): string {
  return new Intl.NumberFormat("en-AE").format(value || 0);
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
