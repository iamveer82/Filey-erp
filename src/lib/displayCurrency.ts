// Which currency the dashboards, KPI strips and list totals are stated in.
//
// This is a VIEW setting, deliberately kept off the company profile: changing
// it restates what this user sees, and never touches what a customer sees on a
// document. Per-document currency stays the document's own (invoice.currency),
// which is what gets printed and charged.
//
// The choice is remembered per device. A device that has never chosen follows
// the company profile's currency.

import { useEffect, useState } from "react";
import { getExchangeRates, type Rates } from "./exchange-rates";
import { setDisplayCurrency, getDisplayCurrency } from "./format";

const KEY = "filey.display.currency";

let rates: Rates = {};
const listeners = new Set<() => void>();

function stored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Point the formatter at a currency and tell every subscriber to re-render. */
export function applyDisplayCurrency(ccy: string, persist = true): void {
  // An unknown currency has no rate; fall back to 1 rather than dividing the
  // whole dashboard by zero.
  setDisplayCurrency(ccy, rates[ccy] ?? 1);
  if (persist) {
    try {
      localStorage.setItem(KEY, ccy);
    } catch {
      /* private mode — the choice just won't outlive the session */
    }
  }
  for (const l of listeners) l();
}

/** Boot: load rates, then honour the device's choice over the company default. */
export async function initDisplayCurrency(companyCcy?: string | null): Promise<void> {
  try {
    rates = await getExchangeRates();
  } catch {
    rates = {};
  }
  applyDisplayCurrency(stored() || companyCcy || "AED", false);
}

/** Subscribe a component to the current display currency. */
export function useDisplayCurrency(): {
  currency: string;
  setCurrency: (c: string) => void;
} {
  const [currency, set] = useState(getDisplayCurrency());
  useEffect(() => {
    const l = () => set(getDisplayCurrency());
    listeners.add(l);
    l(); // rates may have landed between first render and subscribing
    return () => {
      listeners.delete(l);
    };
  }, []);
  return { currency, setCurrency: (c) => applyDisplayCurrency(c) };
}
