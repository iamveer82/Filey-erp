type Row = Record<string, unknown>;
const columns: Record<string, string> = {
  invoice_docs: "number", quotations: "number", purchase_orders: "po_number",
  orders: "order_number", payment_receipts: "number",
};
const keys = new Set(["letters", "packaging_lists", "delivery_challans", "declaration_letters"]);
const numberOf = (row: Row): unknown => {
  const form = row.form;
  return form && typeof form === "object" ? (form as Row).number : row.number ?? row.ref;
};
const normalized = (value: unknown): string => typeof value === "string" ? value.trim().toLowerCase() : "";
const sameWorkspace = (a: Row, b: Row): boolean => !a.org_id || !b.org_id || a.org_id === b.org_id;
function valid(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 160 || Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))
    throw new Error("Enter a valid document number before saving.");
  return normalized(value);
}
function records(row: Row): Row[] {
  if (typeof row.value !== "string") throw new Error("Saved document numbers could not be read. Original records were preserved.");
  const value: unknown = JSON.parse(row.value);
  if (!Array.isArray(value) || value.length > 10000 || value.some(item => !item || typeof item !== "object" || Array.isArray(item)))
    throw new Error("Saved document numbers could not be read. Original records were preserved.");
  return value;
}

/** Guard local mutations just like cloud triggers. Historical duplicate numbers
 * can be edited in place; new records and number changes cannot add duplicates.
 * Sync/import replacements have their own source/revision validation boundary. */
export function validateNumberedCollection(table: string, previous: Row[], next: Row[]): void {
  const column = columns[table];
  if (column) {
    for (const row of next) {
      const old = previous.find(item => item.id === row.id && item.org_id === row.org_id);
      if (old && old[column] === row[column]) continue;
      const number = valid(row[column]);
      if (next.some(other => other !== row && sameWorkspace(row, other) && normalized(other[column]) === number))
        throw new Error("This document number is already in use. Choose another number.");
    }
    return;
  }
  if (table !== "app_settings") return;
  for (const row of next) {
    if (!keys.has(String(row.key))) continue;
    const old = previous.find(item => item.id === row.id && item.org_id === row.org_id && item.key === row.key);
    if (old && old.value === row.value) continue;
    const before = old ? records(old) : [];
    const after = records(row);
    for (const record of after) {
      const value = numberOf(record);
      const sameId = (item: Row) => item.id === record.id;
      if (after.filter(sameId).length > Math.max(1, before.filter(sameId).length))
        throw new Error("A document identity cannot be duplicated. Create a new document.");
      const sameValue = (item: Row) => sameId(item) && numberOf(item) === value;
      if (before.filter(sameValue).length >= after.filter(sameValue).length) continue;
      if (typeof record.id !== "string" || !record.id.trim()) throw new Error("A new document needs a valid identity.");
      const number = valid(value);
      if (after.filter(item => normalized(numberOf(item)) === number).length > 1 ||
          next.some(other => other !== row && other.key === row.key && sameWorkspace(row, other) &&
            records(other).some(item => normalized(numberOf(item)) === number)))
        throw new Error("This document number is already in use. Choose another number.");
    }
  }
}
