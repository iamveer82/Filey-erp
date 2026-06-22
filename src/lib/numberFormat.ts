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
