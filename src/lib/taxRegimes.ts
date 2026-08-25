// Tax regimes keyed by currency — the rules engine behind the currency
// switcher. Switching the app to INR is not a relabelling exercise: India
// charges GST (slab rates, GSTIN identifiers), the UAE charges 5% VAT under
// the FTA, Saudi 15% VAT under ZATCA. New documents adopt the regime of the
// currency they are raised in; existing documents keep the rules they were
// issued under.
//
// Scope note: India's CGST/SGST intra-state split needs a place-of-supply
// model the documents don't carry yet, so the single-line presentation equals
// the inter-state (IGST) form — one GST line at the slab rate. The slabs
// themselves are the real ones.

export interface TaxRegime {
  id: string;
  country: string;
  /** ISO currency code that triggers this regime. */
  currency: string;
  /** Tax name on documents and forms: "VAT", "GST". */
  taxLabel: string;
  /** Registration-number label: "TRN", "GSTIN", "VAT No.". */
  trnLabel: string;
  /** Default rate (%) pre-filled on new documents. Absent = keep the
   *  company's own default (generic regimes have no statutory answer). */
  defaultRate?: number;
  /** Statutory rates (%) the regime recognises, for pickers and hints. */
  rates: number[];
  authority: string;
}

const GENERIC: TaxRegime = {
  id: "generic",
  country: "International",
  currency: "*",
  taxLabel: "Tax",
  trnLabel: "Tax ID",
  rates: [],
  authority: "",
};

const REGIMES: Record<string, TaxRegime> = {
  AED: {
    id: "uae-vat",
    country: "United Arab Emirates",
    currency: "AED",
    taxLabel: "VAT",
    trnLabel: "TRN",
    defaultRate: 5,
    rates: [0, 5],
    authority: "UAE Federal Tax Authority",
  },
  INR: {
    id: "in-gst",
    country: "India",
    currency: "INR",
    taxLabel: "GST",
    trnLabel: "GSTIN",
    defaultRate: 18,
    rates: [0, 5, 12, 18, 28],
    authority: "GST Council",
  },
  SAR: {
    id: "ksa-vat",
    country: "Saudi Arabia",
    currency: "SAR",
    taxLabel: "VAT",
    trnLabel: "VAT No.",
    defaultRate: 15,
    rates: [0, 15],
    authority: "ZATCA",
  },
};

/** The regime governing a currency. Unknown currencies get a neutral
 *  "Tax / Tax ID" regime so documents stay renderable anywhere. */
export function taxRegimeFor(currency?: string | null): TaxRegime {
  const ccy = (currency || "").trim().toUpperCase();
  return REGIMES[ccy] ?? GENERIC;
}

/** True when the currency's regime is the UAE's (gates UAE-only features like
 *  the Peppol PINT-AE e-invoice XML). */
export function isUaeRegime(currency?: string | null): boolean {
  return taxRegimeFor(currency).id === "uae-vat";
}

/** The rate a NEW document of this currency starts on: the regime's statutory
 *  default when it has one, otherwise the company's own default. */
export function defaultTaxRate(
  currency: string | null | undefined,
  companyDefault: number | null | undefined
): number {
  const regime = taxRegimeFor(currency);
  return regime.defaultRate ?? companyDefault ?? 0;
}
