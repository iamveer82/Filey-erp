/* A workspace's invoice preset: the extra columns every new invoice gets, how a column is
 * worked out from the quantity, and which column the rate is per. Saved per workspace, so each
 * Filey user sets their own ("always add T.Liters = qty × liters, rate per T.Liters"); the agent
 * applies it to every invoice draft it makes.
 *
 * Example: { columns: [{ key: "liters", label: "T.Liters", per_unit: true }], price_by: "liters",
 *            unit_sizes: { "virgin drum": 200 } }
 * → "48 RC Pail 20L at 0.20" gets T.Liters 960 and amount 960 × 0.20 = 192. */
import { tools } from "./api";

export interface PresetColumn {
  key: string;
  label: string;
  /** Value = qty × the size of one unit (20 for a 20 L pail). */
  per_unit?: boolean;
}
export interface InvoicePreset {
  columns: PresetColumn[];
  /** The column the rate is per (amount = column × rate); omit for qty × rate. */
  price_by?: string;
  /** Size of one unit by item name, for names that don't say it ("virgin drum": 200). */
  unit_sizes?: Record<string, number>;
}

export const INVOICE_PRESET_KEY = "invoice_preset";

export async function loadInvoicePreset(): Promise<InvoicePreset | null> {
  const row = (await tools.settings()).find(r => r.key === INVOICE_PRESET_KEY);
  if (!row?.value) return null;
  const value = JSON.parse(row.value) as InvoicePreset;
  return Array.isArray(value?.columns) ? value : null;
}

export async function saveInvoicePreset(preset: InvoicePreset | null): Promise<void> {
  await tools.setSetting(INVOICE_PRESET_KEY, preset ? JSON.stringify(preset) : "");
}

/** One unit's size: a saved size for the item, else the name's own ("RC Pail 20L", "25 kg bag"). */
export function unitSize(column: PresetColumn, text: string, sizes: Record<string, number> = {}): number | undefined {
  const lower = text.toLowerCase();
  const saved = Object.keys(sizes).sort((a, b) => b.length - a.length).find(name => lower.includes(name.toLowerCase()));
  if (saved) return sizes[saved];
  const kind = `${column.key} ${column.label}`.toLowerCase();
  const unit = /lit|ltr/.test(kind) ? "(?:l|ltr|ltrs|litre|litres|liter|liters)" : /kg|kilo/.test(kind) ? "(?:kg|kgs|kilo|kilos|kilograms?)" : "";
  const match = unit && lower.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unit}\\b`));
  return match ? Number(match[1]) : undefined;
}

type Line = { description: string; qty: number; unit?: string; custom?: Record<string, string> };

const CONTAINER = /\b(pail|drum|can|bottle|bucket|carton|barrel|ibc|tin|bag|box|jerrycan|tote|pack)s?\b/i;

/** The container an item comes in, from its own text ("H/O 68 PAIL 20L" → "Pail"). */
export function containerOf(text: string): string | undefined {
  const word = text.match(CONTAINER)?.[1];
  return word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : undefined;
}

/** The preset applied to a new invoice: its columns added, per-unit columns worked out per line
 *  (a value the user gave is kept), and the rate column used unless the request set another.
 *  `missing` names the items whose unit size is unknown — ask, don't guess. */
export function applyInvoicePreset<T extends Line>(preset: InvoicePreset | null, cols: { key: string; label: string }[], priceBy: string, items: T[]) {
  if (!preset) return { cols, priceBy, items, missing: [] as string[] };
  const columns = [...cols, ...preset.columns.filter(c => !cols.some(have => have.key === c.key)).map(({ key, label }) => ({ key, label }))];
  const missing: string[] = [];
  const lines = items.map(item => {
    const custom = { ...item.custom };
    const perUnit = preset.columns.filter(c => c.per_unit);
    for (const column of perUnit) {
      if (String(custom[column.key] ?? "").trim()) continue;
      const size = unitSize(column, `${item.description} ${item.unit ?? ""}`, preset.unit_sizes);
      if (size === undefined) { missing.push(item.description); continue; }
      custom[column.key] = String(Math.round(item.qty * size * 1000) / 1000);
    }
    // The qty counts containers ("20 × PAIL 20L"); name the unit after them when none was given.
    const unit = item.unit || (perUnit.length ? containerOf(item.description) : undefined);
    return { ...item, custom, ...(unit ? { unit } : {}) };
  });
  return { cols: columns, priceBy: priceBy || preset.price_by || "", items: lines, missing };
}

/** One line for the agent's brief, so it knows the preset is in force. */
export function describeInvoicePreset(preset: InvoicePreset): string {
  const cols = preset.columns.map(c => `${c.label}${c.per_unit ? " (= qty × size of one unit)" : ""}`).join(", ");
  const rate = preset.price_by ? `; rate is per ${preset.columns.find(c => c.key === preset.price_by)?.label ?? preset.price_by}` : "";
  const sizes = Object.entries(preset.unit_sizes ?? {}).map(([name, size]) => `${name} = ${size}`).join(", ");
  return `Invoice preset (applied to every new draft automatically): columns ${cols}${rate}${sizes ? `; unit sizes: ${sizes}` : ""}.`;
}
