// Shared storage for the user-defined invoice number format.
// The format string itself is interpreted by lib/docNumber (nextFromPattern).
import { tools } from "./api";

export const INVOICE_FORMAT_KEY = "invoice_number_format";

/** The saved invoice format, or "" when the user hasn't set one. */
export async function loadInvoiceFormat(): Promise<string> {
  const rows = await tools.settings().catch(() => []);
  return rows.find((r) => r.key === INVOICE_FORMAT_KEY)?.value ?? "";
}

export function saveInvoiceFormat(pattern: string): Promise<void> {
  return tools.setSetting(INVOICE_FORMAT_KEY, pattern.trim());
}

/* Quotations number themselves the same way. Kept as its own setting rather
 * than sharing the invoice one: a quote and the invoice it becomes are
 * different documents to a customer and to an auditor, and they should not
 * draw from the same counter. */
export const QUOTE_FORMAT_KEY = "quote_number_format";

/** The saved quotation format, or "" when the user hasn't set one. */
export async function loadQuoteFormat(): Promise<string> {
  const rows = await tools.settings().catch(() => []);
  return rows.find((r) => r.key === QUOTE_FORMAT_KEY)?.value ?? "";
}

export function saveQuoteFormat(pattern: string): Promise<void> {
  return tools.setSetting(QUOTE_FORMAT_KEY, pattern.trim());
}
