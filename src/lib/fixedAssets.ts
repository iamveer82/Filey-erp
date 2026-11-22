// Fixed assets register and depreciation: what the business owns for the long run
// (vehicles, machines, computers) and how much of its cost each month uses up.
//
// ponytail: one JSON setting ("fixed_assets"), like the invoice preset. A small business
// owns tens of assets; a table earns its migration when someone needs hundreds, or a
// per-asset history. Disposal only stops depreciation: the sale itself (proceeds, gain or
// loss) is still a journal entry.

import { fin, tools } from "./api";
import { r2 } from "./money";
import { todayYmd } from "./format";

export type DepreciationMethod = "straight_line" | "declining_balance";

export interface FixedAsset {
  id: string;
  name: string;
  category: string;
  /** YYYY-MM-DD. Depreciation starts in this month, as a full month. */
  purchase_date: string;
  cost: number;
  /** What it is still worth at the end; never depreciated below this. */
  salvage: number;
  /** Straight line: months to spread the cost over. */
  life_months: number;
  method: DepreciationMethod;
  /** Declining balance: percent of the remaining value written off per year. */
  rate?: number;
  /** YYYY-MM: depreciation up to and including this month is in the books. */
  posted_through?: string;
  /** YYYY-MM-DD: sold or scrapped. No depreciation from this month on. */
  disposed_on?: string;
  notes?: string;
}

export const FIXED_ASSETS_KEY = "fixed_assets";
export const ASSET_CATEGORIES = ["Vehicle", "Machinery", "Equipment", "Computer", "Furniture", "Building", "Other"];

const monthIndex = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
const monthOf = (index: number) => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
const validDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
export const currentMonth = () => todayYmd().slice(0, 7);

/** Month by month, from the purchase month through `through` (YYYY-MM). Ends when the
 *  asset is written down to its end value, or the month before it was disposed of. */
export function depreciationSchedule(a: FixedAsset, through: string): { month: string; amount: number }[] {
  const start = monthIndex(a.purchase_date.slice(0, 7));
  let end = monthIndex(through);
  if (a.disposed_on) end = Math.min(end, monthIndex(a.disposed_on.slice(0, 7)) - 1);
  const base = r2(Math.max(0, a.cost - a.salvage));
  const out: { month: string; amount: number }[] = [];
  let left = base;
  for (let i = start; i <= end && left > 0 && i - start < 1200; i++) {
    let amount: number;
    if (a.method === "declining_balance") {
      // ponytail: reducing balance month by month (rate/12 of what is left). A statutory
      // year-based table (India's block-of-assets WDV) differs a little; add it if a
      // filing needs those exact figures.
      amount = r2(((left + a.salvage) * (a.rate ?? 0)) / 1200);
    } else {
      // The last month takes whatever rounding left over, so the total is exact.
      amount = i - start >= a.life_months - 1 ? left : r2(base / a.life_months);
    }
    amount = Math.min(left, amount);
    if (amount <= 0) break;
    out.push({ month: monthOf(i), amount });
    left = r2(left - amount);
  }
  return out;
}

export interface AssetFigures {
  /** Written off so far, through the month asked for. */
  accumulated: number;
  book_value: number;
  this_month: number;
  /** Depreciation not yet in the books, and the months it covers. */
  due: number;
  due_from?: string;
  due_to?: string;
}

export function assetFigures(a: FixedAsset, through = currentMonth()): AssetFigures {
  const rows = depreciationSchedule(a, through);
  const accumulated = r2(rows.reduce((sum, row) => sum + row.amount, 0));
  const unposted = rows.filter((row) => !a.posted_through || row.month > a.posted_through);
  return {
    accumulated,
    book_value: r2(a.cost - accumulated),
    this_month: rows.find((row) => row.month === through)?.amount ?? 0,
    due: r2(unposted.reduce((sum, row) => sum + row.amount, 0)),
    due_from: unposted[0]?.month,
    due_to: unposted[unposted.length - 1]?.month,
  };
}

export type FixedAssetInput = Omit<FixedAsset, "id" | "posted_through" | "disposed_on">;

/** Checked and tidied, or an error in words the owner can act on. */
export function cleanAsset(input: FixedAssetInput): FixedAssetInput {
  const name = String(input.name ?? "").trim().slice(0, 120);
  const cost = Number(input.cost);
  const salvage = Number(input.salvage ?? 0);
  const method: DepreciationMethod = input.method === "declining_balance" ? "declining_balance" : "straight_line";
  const life = Math.round(Number(input.life_months));
  const rate = Number(input.rate ?? 0);
  if (!name) throw new Error("Give the asset a name.");
  if (!validDate(String(input.purchase_date))) throw new Error("Enter the purchase date as YYYY-MM-DD.");
  if (!Number.isFinite(cost) || cost <= 0 || cost >= 1e12 || cost !== r2(cost)) throw new Error("Enter what the asset cost, above zero, with at most two decimals.");
  if (!Number.isFinite(salvage) || salvage < 0 || salvage >= cost || salvage !== r2(salvage)) throw new Error("The end value must be zero or more, and less than the cost.");
  if (method === "straight_line" && !(life >= 1 && life <= 1200)) throw new Error("Enter how long the asset will last, between 1 month and 100 years.");
  if (method === "declining_balance" && !(rate > 0 && rate <= 100)) throw new Error("Enter the yearly rate as a percent between 0 and 100.");
  return {
    name,
    category: String(input.category ?? "").trim().slice(0, 40) || "Other",
    purchase_date: String(input.purchase_date),
    cost,
    salvage,
    life_months: method === "straight_line" ? life : 0,
    method,
    ...(method === "declining_balance" ? { rate } : {}),
    ...(String(input.notes ?? "").trim() ? { notes: String(input.notes).trim().slice(0, 500) } : {}),
  };
}

export async function loadFixedAssets(): Promise<FixedAsset[]> {
  const row = (await tools.settings()).find((r) => r.key === FIXED_ASSETS_KEY);
  if (!row?.value) return [];
  let list: unknown;
  // Never answer "no assets" for a list that failed to read: the next save would erase it.
  try { list = JSON.parse(row.value); } catch { throw new Error("The fixed assets list could not be read."); }
  if (!Array.isArray(list)) throw new Error("The fixed assets list could not be read.");
  return list as FixedAsset[];
}

async function saveFixedAssets(list: FixedAsset[]): Promise<void> {
  await tools.setSetting(FIXED_ASSETS_KEY, JSON.stringify(list));
}

/** The tag that ties journal lines to one asset and period, so a repeated run posts nothing twice. */
const tag = (a: FixedAsset, what: string) => `[${what} ${a.id.slice(0, 8)}]`;

export async function addFixedAsset(input: FixedAssetInput, opts: { recordPurchase?: boolean } = {}): Promise<FixedAsset> {
  const asset: FixedAsset = { id: crypto.randomUUID(), ...cleanAsset(input) };
  await saveFixedAssets([...(await loadFixedAssets()), asset]);
  if (opts.recordPurchase) {
    try {
      await fin.postFixedAsset("purchase", asset.cost, asset.purchase_date, `Asset bought: ${asset.name.slice(0, 60)} ${tag(asset, "ASSET")}`);
    } catch (e) {
      throw new Error(`${asset.name} is saved, but its purchase could not be recorded in the books: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return asset;
}

async function change(id: string, apply: (list: FixedAsset[], at: number) => void): Promise<void> {
  const list = await loadFixedAssets();
  const at = list.findIndex((a) => a.id === id);
  if (at < 0) throw new Error("That asset is no longer in the list.");
  apply(list, at);
  await saveFixedAssets(list);
}

/** Sold or scrapped: depreciation stops from that month. The journal lines stay. */
export function disposeFixedAsset(id: string, date: string): Promise<void> {
  if (!validDate(date)) throw new Error("Enter the date as YYYY-MM-DD.");
  return change(id, (list, at) => {
    if (date < list[at].purchase_date) throw new Error("An asset cannot be disposed of before it was bought.");
    list[at] = { ...list[at], disposed_on: date };
  });
}

/** Takes it off the list only. Anything already posted to the journal stays there. */
export function removeFixedAsset(id: string): Promise<void> {
  return change(id, (list, at) => { list.splice(at, 1); });
}

const lastDay = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);

export interface DepreciationRun {
  posted: { name: string; amount: number; from: string; to: string }[];
  total: number;
}

/** Put every asset's unposted depreciation, through `through` (YYYY-MM), into the books:
 *  one debit to Depreciation and one credit to Accumulated Depreciation per asset. */
export async function postDepreciation(through = currentMonth()): Promise<DepreciationRun> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(through)) throw new Error("Give the month as YYYY-MM.");
  if (through > currentMonth()) throw new Error("Depreciation can be posted up to this month, not for months ahead.");
  const assets = await loadFixedAssets();
  const posted: DepreciationRun["posted"] = [];
  let journal: Awaited<ReturnType<typeof fin.transactions>> | null = null;
  for (let at = 0; at < assets.length; at++) {
    const asset = assets[at];
    const due = assetFigures(asset, through);
    if (!(due.due > 0) || !due.due_from || !due.due_to) continue;
    const key = `[DEP ${asset.id.slice(0, 8)} ${due.due_from}..${due.due_to}]`;
    const period = due.due_from === due.due_to ? due.due_from : `${due.due_from} to ${due.due_to}`;
    // A run cut off halfway leaves one side posted, or both posted with the list not yet
    // updated. Post only what is missing, so trying again never doubles an entry.
    journal ??= await fin.transactions();
    const sides = new Set(journal.filter((t) => t.description?.includes(key)).map((t) => t.txn_type));
    if (!sides.has("debit") || !sides.has("credit")) {
      const date = lastDay(due.due_to) > todayYmd() ? todayYmd() : lastDay(due.due_to);
      await fin.postFixedAsset("depreciation", due.due, date, `Depreciation: ${asset.name.slice(0, 60)}, ${period} ${key}`,
        sides.has("debit") ? "credit" : sides.has("credit") ? "debit" : undefined);
    }
    assets[at] = { ...asset, posted_through: due.due_to };
    // Saved after each asset: a failure further down keeps what is already in the books marked.
    await saveFixedAssets(assets);
    posted.push({ name: asset.name, amount: due.due, from: due.due_from, to: due.due_to });
  }
  return { posted, total: r2(posted.reduce((sum, p) => sum + p.amount, 0)) };
}
