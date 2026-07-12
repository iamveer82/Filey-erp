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
const SCALE = ["", " Thousand", " Million", " Billion"];

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

const CURRENCY_WORDS: Record<string, { main: string; sub: string }> = {
  AED: { main: "UAE Dirhams", sub: "Fils" },
  USD: { main: "US Dollars", sub: "Cents" },
  EUR: { main: "Euros", sub: "Cents" },
  GBP: { main: "Pounds Sterling", sub: "Pence" },
  INR: { main: "Indian Rupees", sub: "Paise" },
  SAR: { main: "Saudi Riyals", sub: "Halalas" },
};

/** "UAE Dirhams Three Thousand Three Hundred Twenty and Fils Ten Only" */
export function amountInWords(amount: number, currency = "AED"): string {
  if (!Number.isFinite(amount)) return "";
  const cur = CURRENCY_WORDS[currency] ?? { main: currency, sub: "" };
  const whole = Math.floor(Math.abs(amount));
  const frac = Math.round((Math.abs(amount) - whole) * 100);
  let out = `${cur.main} ${numberToWords(whole)}`;
  if (frac > 0 && cur.sub) out += ` and ${cur.sub} ${numberToWords(frac)}`;
  return `${out} Only`;
}
