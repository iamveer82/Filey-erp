// Amount-in-words for invoice totals (UAE convention):
// "UAE Dirhams Three Thousand Three Hundred Twenty and Fils Ten Only".
// English only — the FTA accepts English tax invoices; add Arabic via the
// i18n catalogs if ever required.

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const SCALE = ["", " Thousand", " Million", " Billion", " Trillion"];

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (r < 20) {
    if (r) parts.push(ONES[r]);
  } else {
    const t = TENS[Math.floor(r / 10)];
    parts.push(r % 10 ? `${t} ${ONES[r % 10]}` : t);
  }
  return parts.join(" ");
}

export function numberToWords(n: number): string {
  if (!Number.isFinite(n)) return "";
  n = Math.floor(Math.abs(n));
  if (n === 0) return "Zero";
  const groups: string[] = [];
  for (let i = 0; n > 0 && i < SCALE.length; i++) {
    const g = n % 1000;
    if (g) groups.unshift(threeDigits(g) + SCALE[i]);
    n = Math.floor(n / 1000);
  }
  return groups.join(" ");
}

/** Every currency offered by the pickers (format.ts CURRENCIES). `digits` is the
 *  minor-unit exponent (ISO 4217), matching how money() prints the figure:
 *  three decimals for the Gulf dinars/rial, none for yen. An empty `sub` means
 *  the minor unit is not used in practice, so fractions are rounded away. */
const CURRENCY_WORDS: Record<string, { main: string; sub: string; digits?: number }> = {
  AED: { main: "UAE Dirhams", sub: "Fils" },
  USD: { main: "US Dollars", sub: "Cents" },
  EUR: { main: "Euros", sub: "Cents" },
  GBP: { main: "Pounds Sterling", sub: "Pence" },
  INR: { main: "Indian Rupees", sub: "Paise" },
  SAR: { main: "Saudi Riyals", sub: "Halalas" },
  QAR: { main: "Qatari Riyals", sub: "Dirhams" },
  KWD: { main: "Kuwaiti Dinars", sub: "Fils", digits: 3 },
  BHD: { main: "Bahraini Dinars", sub: "Fils", digits: 3 },
  OMR: { main: "Omani Rials", sub: "Baisa", digits: 3 },
  CHF: { main: "Swiss Francs", sub: "Rappen" },
  CAD: { main: "Canadian Dollars", sub: "Cents" },
  AUD: { main: "Australian Dollars", sub: "Cents" },
  NZD: { main: "New Zealand Dollars", sub: "Cents" },
  SGD: { main: "Singapore Dollars", sub: "Cents" },
  ZAR: { main: "South African Rand", sub: "Cents" },
  CZK: { main: "Czech Koruna", sub: "Haleru" },
  DKK: { main: "Danish Kroner", sub: "Ore" },
  SEK: { main: "Swedish Kronor", sub: "Ore" },
  PLN: { main: "Polish Zloty", sub: "Groszy" },
  RON: { main: "Romanian Lei", sub: "Bani" },
  HUF: { main: "Hungarian Forints", sub: "", digits: 0 },
  JPY: { main: "Japanese Yen", sub: "", digits: 0 },
};

/** "UAE Dirhams Three Thousand Three Hundred Twenty and Fils Ten Only" */
export function amountInWords(amount: number, currency = "AED"): string {
  if (!Number.isFinite(amount)) return "";
  const known = CURRENCY_WORDS[currency];
  const cur = known ?? { main: currency, sub: "" };
  const digits = cur.digits ?? 2;
  const unit = 10 ** digits;
  // Round to the minor unit first, then split. Splitting first and rounding
  // the fraction turns 9.996 into "Nine and Fils One Hundred" instead of "Ten".
  const minor = Math.round(Math.abs(amount) * unit);
  const whole = Math.floor(minor / unit);
  const frac = minor % unit;
  let out = `${cur.main} ${numberToWords(whole)}`;
  if (frac > 0) {
    if (cur.sub) out += ` and ${cur.sub} ${numberToWords(frac)}`;
    // Unknown code: no minor-unit name to use, but the fraction must not be
    // silently dropped from a legal document — use the cheque-style "50/100".
    else if (!known) out += ` and ${frac}/${unit}`;
  }
  return `${out} Only`;
}
