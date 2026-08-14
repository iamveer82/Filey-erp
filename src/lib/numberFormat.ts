// User-defined document number formats, one per document type.
//
// The format string itself is interpreted by lib/docNumber (nextFromPattern):
// the braces hold the counter, so "INV-DLS-{001}-26" yields INV-DLS-001-26,
// INV-DLS-002-26, … Everything outside the braces is fixed.
//
// This started as a single invoice setting. Every other section numbered
// itself with a hardcoded prefix, so a business whose quotes read QT-0001 and
// whose invoices read INV-DLS-014-26 had no way to make the rest match. Each
// type now keeps its own format under its own key — deliberately not one
// shared counter, since a quote, the invoice it becomes and the receipt that
// pays it are separate documents to a customer and to an auditor.
import { tools } from "./api";
import { nextDocNumber, nextFromPattern, hasCounter } from "./docNumber";

export type DocNumberKind =
  | "invoice"
  | "purchase_invoice"
  | "quote"
  | "purchase_order"
  | "delivery_challan"
  | "payment_receipt"
  | "declaration_letter"
  | "sales_order";

export interface DocNumberSpec {
  kind: DocNumberKind;
  label: string;
  /** Built-in scheme used when no format is set. */
  prefix: string;
  placeholder: string;
}

export const DOC_NUMBER_KINDS: DocNumberSpec[] = [
  { kind: "invoice", label: "Invoices", prefix: "INV", placeholder: "INV-DLS-{001}-26" },
  { kind: "purchase_invoice", label: "Purchase invoices", prefix: "PINV", placeholder: "PINV-{001}-26" },
  { kind: "quote", label: "Quotations", prefix: "QT", placeholder: "QT-DLS-{001}-26" },
  { kind: "purchase_order", label: "Purchase orders", prefix: "PO", placeholder: "PO-{001}-26" },
  { kind: "delivery_challan", label: "Delivery challans", prefix: "DC", placeholder: "DC-{001}-26" },
  { kind: "payment_receipt", label: "Payment receipts", prefix: "REC", placeholder: "REC-{001}-26" },
  { kind: "declaration_letter", label: "Declaration letters", prefix: "DL", placeholder: "DL-{001}-26" },
  { kind: "sales_order", label: "Sales orders", prefix: "SO", placeholder: "SO-{001}-26" },
];

/** Setting key for a kind. Invoices and quotes keep the keys they shipped with
 *  so nobody's saved format is orphaned by this generalisation. */
export function formatKey(kind: DocNumberKind): string {
  if (kind === "invoice") return INVOICE_FORMAT_KEY;
  if (kind === "quote") return QUOTE_FORMAT_KEY;
  return `${kind}_number_format`;
}

export const INVOICE_FORMAT_KEY = "invoice_number_format";
export const QUOTE_FORMAT_KEY = "quote_number_format";

export type DocFormats = Partial<Record<DocNumberKind, string>>;

/** Every saved format, in one read. */
export async function loadDocFormats(): Promise<DocFormats> {
  const rows = await tools.settings().catch(() => []);
  const out: DocFormats = {};
  for (const spec of DOC_NUMBER_KINDS) {
    const v = rows.find((r) => r.key === formatKey(spec.kind))?.value;
    if (v) out[spec.kind] = v;
  }
  return out;
}

export async function saveDocFormat(kind: DocNumberKind, pattern: string): Promise<void> {
  await tools.setSetting(formatKey(kind), pattern.trim());
}

/** The next number for a document type: the user's format when they have set
 *  one with a counter in it, otherwise the built-in prefix scheme. */
export function pickDocNumber(
  kind: DocNumberKind,
  existing: string[],
  formats?: DocFormats
): string {
  const pattern = formats?.[kind];
  if (pattern && hasCounter(pattern)) return nextFromPattern({ pattern, existing });
  const spec = DOC_NUMBER_KINDS.find((s) => s.kind === kind);
  return nextDocNumber({ prefix: spec?.prefix ?? "DOC", existing });
}

/* ---- back-compat wrappers for the two callers that predate the generalisation ---- */

/** The saved invoice format, or "" when the user hasn't set one. */
export async function loadInvoiceFormat(): Promise<string> {
  return (await loadDocFormats()).invoice ?? "";
}

export function saveInvoiceFormat(pattern: string): Promise<void> {
  return saveDocFormat("invoice", pattern);
}

/** The saved quotation format, or "" when the user hasn't set one. */
export async function loadQuoteFormat(): Promise<string> {
  return (await loadDocFormats()).quote ?? "";
}

export function saveQuoteFormat(pattern: string): Promise<void> {
  return saveDocFormat("quote", pattern);
}
