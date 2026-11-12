/* India: tax deducted at source (TDS, kept back by the payer) and tax collected at
 * source (TCS, added by the seller). Rates are the usual ones; the payer's PAN status
 * and thresholds can change them, so every amount stays editable. */
import { docTotals, type DocItem } from "./docItems";

const r2 = (n: number) => Math.round(n * 100) / 100;

export const TDS_SECTIONS = [
  { value: "194C", label: "194C contractor (1% individual, 2% firm)", rate: 2 },
  { value: "194J", label: "194J professional fees (10%)", rate: 10 },
  { value: "194J technical", label: "194J technical services (2%)", rate: 2 },
  { value: "194H", label: "194H commission (2%)", rate: 2 },
  { value: "194I", label: "194I rent (10% building, 2% machinery)", rate: 10 },
  { value: "194Q", label: "194Q purchase of goods (0.1%)", rate: 0.1 },
  { value: "", label: "Other section", rate: 0 },
];

/** Payment rows saved for TDS carry this method, so they can be told apart and reversed. */
export const tdsMethod = (section: string) => `TDS ${section}`.trim();
export const isTdsMethod = (method?: string | null) => /^TDS\b/.test(method ?? "");

/** TDS is worked out on the value before GST when the GST is shown separately. */
export const tdsAmount = (netValue: number, rate: number) => Math.max(0, Math.round(netValue * rate / 100));

export const TCS_SECTIONS = [
  { value: "206C(1)", label: "206C(1) scrap, minerals, forest produce (1%)", rate: 1 },
  { value: "206C(1F)", label: "206C(1F) motor vehicle or luxury goods over ₹10 lakh (1%)", rate: 1 },
  { value: "206C(1) liquor", label: "206C(1) alcoholic liquor (1%)", rate: 1 },
];

/** A TCS line is an ordinary invoice line outside GST, marked in its custom fields. */
export const isTcsLine = (item: Pick<DocItem, "custom">) => !!item.custom?.tcs;

/** Lines on the invoice with each TCS line priced at its rate of everything else, GST included. */
export function withTcs<T extends DocItem>(items: T[], discount: number, taxRate: number, formula?: { a: string; b?: string } | null): T[] {
  if (!items.some(isTcsLine)) return items;
  const base = docTotals(items.filter((i) => !isTcsLine(i)), discount, taxRate, formula).total;
  return items.map((item) => {
    if (!isTcsLine(item)) return item;
    const price = r2(base * (Number(item.custom?.tcs) || 0) / 100);
    return Number(item.unit_price) === price && Number(item.qty) === 1 ? item : { ...item, qty: 1, unit_price: price };
  });
}
