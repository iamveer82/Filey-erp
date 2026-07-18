/**
 * Shared document template registry used by Invoicing, Quoting,
 * Purchase Orders and Payment Receipts. Custom templates created in any
 * module are also available everywhere because they share the same
 * localStorage / Supabase setting key.
 */
export const DOC_TEMPLATES = [
  { id: "minimal", name: "Minimal" },
  { id: "classic", name: "Classic" },
  { id: "modern", name: "Modern" },
  { id: "corporate", name: "Corporate" },
  { id: "elegant", name: "Elegant" },
  { id: "bold", name: "Bold" },
  { id: "tech", name: "Tech" },
  { id: "creative", name: "Creative" },
  { id: "receipt", name: "Receipt" },
  { id: "monogram", name: "Monogram" },
  { id: "green-gold", name: "Green Gold" },
  { id: "uae", name: "UAE Professional" },
  { id: "fta", name: "UAE FTA Tax Invoice" },
  { id: "industrial", name: "Industrial" },
  { id: "executive", name: "Executive" },
  { id: "fresh", name: "Fresh" },
  // Emergent-reference ports (v2.1) — additive; originals above unchanged.
  { id: "em-minimal", name: "Minimal Pro" },
  { id: "em-uae", name: "UAE FTA Compact" },
  { id: "em-classic", name: "Classic Serif" },
  { id: "em-modern", name: "Modern Blue" },
  { id: "em-corporate", name: "Corporate Dark" },
  { id: "em-elegant", name: "Elegant Ivory" },
  // DEMO receipt-template ports (v2.2) — receipt-first themes; additive.
  { id: "rec-modern", name: "Receipt Modern" },
  { id: "rec-minimal", name: "Receipt Minimal" },
  { id: "rec-classic", name: "Receipt Classic" },
  { id: "rec-corporate", name: "Receipt Corporate" },
  { id: "rec-thermal", name: "Receipt Thermal" },
  { id: "rec-elegant", name: "Receipt Elegant" },
  // UAE reference-pack ports (v2.3) — rendered by UaePackDoc.tsx; additive.
  { id: "uae-full", name: "UAE Full Tax Invoice" },
  { id: "uae-simplified", name: "UAE Simplified Tax Invoice" },
  { id: "uae-reverse", name: "UAE Reverse Charge" },
  { id: "uae-foreign", name: "UAE Foreign Currency" },
  { id: "uae-export", name: "UAE Zero-Rated Export" },
  { id: "uae-mixed", name: "UAE Mixed Supply" },
  { id: "uae-recurring", name: "UAE Recurring Invoice" },
  { id: "uae-freelancer", name: "UAE Freelancer Invoice" },
  { id: "uae-credit-note", name: "UAE Tax Credit Note" },
  { id: "uae-debit-note", name: "UAE Tax Debit Note" },
  { id: "uae-quotation", name: "UAE Quotation" },
  { id: "uae-proforma", name: "UAE Proforma Invoice" },
  { id: "uae-estimate", name: "UAE Estimate" },
  { id: "uae-purchase-order", name: "UAE Purchase Order" },
  { id: "uae-order-confirmation", name: "UAE Order Confirmation" },
  { id: "uae-receipt-voucher", name: "UAE Receipt Voucher" },
  { id: "uae-payment-voucher", name: "UAE Payment Voucher" },
];

/**
 * Legacy template IDs used by the other modules before unification.
 * Resolve them to the closest invoice template so existing documents keep
 * rendering after the template gallery is unified.
 */
export const TEMPLATE_ALIASES: Record<string, string> = {
  clean: "modern",
  professional: "corporate",
  "uae-standard": "uae",
  "uae-minimal": "minimal",
  standard: "receipt",
  formal: "classic",
  simple: "minimal",
};

export function resolveTemplateId(id?: string | null): string {
  if (!id) return "minimal";
  const normalized = id.toLowerCase();
  if (DOC_TEMPLATES.some((t) => t.id === normalized)) return normalized;
  return TEMPLATE_ALIASES[normalized] || "minimal";
}
