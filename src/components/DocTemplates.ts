/**
 * Shared document template registry used by Invoicing, Quoting,
 * Purchase Orders and Payment Receipts. Custom templates created in any
 * module are also available everywhere because they share the same
 * localStorage / Supabase setting key.
 *
 * `category` groups templates in the gallery; `docTypes` limits which
 * modules see which template — so invoice templates don't clutter the
 * quotation picker and vice versa.
 */

export type DocType = "invoice" | "quote" | "po" | "receipt";

export interface DocTemplate {
  id: string;
  name: string;
  category: string;
  docTypes: DocType[];
}

export const DOC_TEMPLATES: DocTemplate[] = [
  // ── General ──
  // Invoice layouts, deliberately NOT offered to receipts: a receipt has its
  // own catalogue (Receipts & Vouchers below) and the General templates render
  // item grids and totals ladders that make a receipt read as an invoice.
  // Saved receipts still render on these ids — DocView keeps the renderers.
  { id: "minimal", name: "Minimal", category: "General", docTypes: ["invoice", "quote", "po"] },
  { id: "classic", name: "Classic", category: "General", docTypes: ["invoice", "quote", "po"] },
  { id: "modern", name: "Modern", category: "General", docTypes: ["invoice", "quote", "po"] },
  { id: "corporate", name: "Corporate", category: "General", docTypes: ["invoice", "quote", "po"] },
  { id: "elegant", name: "Elegant", category: "General", docTypes: ["invoice", "quote", "po"] },
  { id: "bold", name: "Bold", category: "General", docTypes: ["invoice", "quote", "po"] },
  { id: "tech", name: "Tech", category: "General", docTypes: ["invoice", "quote"] },
  { id: "creative", name: "Creative", category: "General", docTypes: ["invoice", "quote"] },
  { id: "monogram", name: "Monogram", category: "General", docTypes: ["invoice", "quote", "po"] },
  { id: "green-gold", name: "Green Gold", category: "General", docTypes: ["invoice", "quote"] },
  { id: "industrial", name: "Industrial", category: "General", docTypes: ["invoice", "quote", "po"] },
  { id: "executive", name: "Executive", category: "General", docTypes: ["invoice", "quote", "po"] },
  { id: "fresh", name: "Fresh", category: "General", docTypes: ["invoice", "quote"] },

  // ── UAE Tax Invoices ──
  { id: "uae", name: "UAE Professional", category: "UAE Tax Invoices", docTypes: ["invoice", "quote", "po"] },
  { id: "fta", name: "UAE FTA Tax Invoice", category: "UAE Tax Invoices", docTypes: ["invoice"] },
  { id: "uae-full", name: "UAE Full Tax Invoice", category: "UAE Tax Invoices", docTypes: ["invoice"] },
  { id: "uae-simplified", name: "UAE Simplified Tax Invoice", category: "UAE Tax Invoices", docTypes: ["invoice"] },
  { id: "uae-reverse", name: "UAE Reverse Charge", category: "UAE Tax Invoices", docTypes: ["invoice"] },
  { id: "uae-foreign", name: "UAE Foreign Currency", category: "UAE Tax Invoices", docTypes: ["invoice"] },
  { id: "uae-export", name: "UAE Zero-Rated Export", category: "UAE Tax Invoices", docTypes: ["invoice"] },
  { id: "uae-mixed", name: "UAE Mixed Supply", category: "UAE Tax Invoices", docTypes: ["invoice"] },
  { id: "uae-recurring", name: "UAE Recurring Invoice", category: "UAE Tax Invoices", docTypes: ["invoice"] },
  { id: "uae-freelancer", name: "UAE Freelancer Invoice", category: "UAE Tax Invoices", docTypes: ["invoice"] },
  { id: "uae-credit-note", name: "UAE Tax Credit Note", category: "UAE Tax Invoices", docTypes: ["invoice"] },
  { id: "uae-debit-note", name: "UAE Tax Debit Note", category: "UAE Tax Invoices", docTypes: ["invoice"] },
  { id: "uae-summary", name: "UAE Summary Invoice", category: "UAE Tax Invoices", docTypes: ["invoice"] },
  { id: "uae-margin", name: "UAE Margin Scheme", category: "UAE Tax Invoices", docTypes: ["invoice"] },
  { id: "uae-agent", name: "UAE Disclosed Agent", category: "UAE Tax Invoices", docTypes: ["invoice"] },
  { id: "uae-designated", name: "UAE Designated Zone", category: "UAE Tax Invoices", docTypes: ["invoice"] },
  { id: "uae-deemed", name: "UAE Deemed Supply", category: "UAE Tax Invoices", docTypes: ["invoice"] },
  { id: "uae-commercial", name: "UAE Commercial Invoice", category: "UAE Tax Invoices", docTypes: ["invoice"] },

  // ── Quotations & Estimates ──
  { id: "uae-quotation", name: "UAE Quotation", category: "Quotations & Estimates", docTypes: ["quote"] },
  { id: "uae-proforma", name: "UAE Proforma Invoice", category: "Quotations & Estimates", docTypes: ["invoice", "quote"] },
  { id: "uae-estimate", name: "UAE Estimate", category: "Quotations & Estimates", docTypes: ["quote"] },
  { id: "uae-order-confirmation", name: "UAE Order Confirmation", category: "Quotations & Estimates", docTypes: ["quote"] },

  // ── Purchase Orders ──
  { id: "uae-purchase-order", name: "UAE Purchase Order", category: "Purchase Orders", docTypes: ["po"] },

  // ── Receipts & Vouchers ──
  // The only catalogue a receipt sees — dedicated money-received layouts, not
  // general invoice designs. The plain "receipt" id lives here too so saved
  // receipts on it keep rendering and stay pickable.
  { id: "voucher", name: "Receipt Voucher", category: "Receipts & Vouchers", docTypes: ["receipt"] },
  { id: "receipt", name: "Receipt", category: "Receipts & Vouchers", docTypes: ["receipt"] },
  { id: "uae-receipt-voucher", name: "UAE Receipt Voucher", category: "Receipts & Vouchers", docTypes: ["receipt"] },
  { id: "uae-payment-voucher", name: "UAE Payment Voucher", category: "Receipts & Vouchers", docTypes: ["receipt"] },
  { id: "uae-petty-cash", name: "UAE Petty Cash Voucher", category: "Receipts & Vouchers", docTypes: ["receipt"] },
  { id: "uae-advance-receipt", name: "UAE Advance Payment Receipt", category: "Receipts & Vouchers", docTypes: ["receipt"] },
  { id: "rec-modern", name: "Receipt Modern", category: "Receipts & Vouchers", docTypes: ["receipt"] },
  { id: "rec-minimal", name: "Receipt Minimal", category: "Receipts & Vouchers", docTypes: ["receipt"] },
  { id: "rec-classic", name: "Receipt Classic", category: "Receipts & Vouchers", docTypes: ["receipt"] },
  { id: "rec-corporate", name: "Receipt Corporate", category: "Receipts & Vouchers", docTypes: ["receipt"] },
  { id: "rec-thermal", name: "Receipt Thermal", category: "Receipts & Vouchers", docTypes: ["receipt"] },
  { id: "rec-elegant", name: "Receipt Elegant", category: "Receipts & Vouchers", docTypes: ["receipt"] },

  // ── Industry-Specific ──
  { id: "uae-construction", name: "UAE Construction Progress", category: "Industry-Specific", docTypes: ["invoice"] },
  { id: "uae-rental", name: "UAE Rental / Lease", category: "Industry-Specific", docTypes: ["invoice"] },
  { id: "uae-restaurant", name: "UAE Restaurant", category: "Industry-Specific", docTypes: ["invoice"] },
  { id: "uae-medical", name: "UAE Medical", category: "Industry-Specific", docTypes: ["invoice"] },
  { id: "uae-education", name: "UAE Education", category: "Industry-Specific", docTypes: ["invoice"] },
  { id: "uae-logistics", name: "UAE Logistics", category: "Industry-Specific", docTypes: ["invoice", "po"] },
  { id: "uae-ecommerce", name: "UAE E-Commerce", category: "Industry-Specific", docTypes: ["invoice"] },
  { id: "uae-hotel", name: "UAE Hotel Folio", category: "Industry-Specific", docTypes: ["invoice"] },
  { id: "uae-salon", name: "UAE Salon", category: "Industry-Specific", docTypes: ["invoice"] },
  { id: "uae-garage", name: "UAE Auto Garage", category: "Industry-Specific", docTypes: ["invoice"] },
  { id: "uae-realestate", name: "UAE Real Estate Commission", category: "Industry-Specific", docTypes: ["invoice"] },
  { id: "uae-amc", name: "UAE Annual Maintenance Contract", category: "Industry-Specific", docTypes: ["invoice", "quote"] },
  { id: "uae-event", name: "UAE Event", category: "Industry-Specific", docTypes: ["invoice", "quote"] },
  { id: "uae-timesheet", name: "UAE IT Timesheet", category: "Industry-Specific", docTypes: ["invoice"] },

  // ── Emergent Reference Ports ──
  { id: "em-minimal", name: "Minimal Pro", category: "Emergent Ports", docTypes: ["invoice", "quote", "po"] },
  { id: "em-uae", name: "UAE FTA Compact", category: "Emergent Ports", docTypes: ["invoice"] },
  { id: "em-classic", name: "Classic Serif", category: "Emergent Ports", docTypes: ["invoice", "quote", "po"] },
  { id: "em-modern", name: "Modern Blue", category: "Emergent Ports", docTypes: ["invoice", "quote", "po"] },
  { id: "em-corporate", name: "Corporate Dark", category: "Emergent Ports", docTypes: ["invoice", "quote", "po"] },
  { id: "em-elegant", name: "Elegant Ivory", category: "Emergent Ports", docTypes: ["invoice", "quote"] },
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

/** Templates visible to a given module, grouped by category. */
export function templatesForDocType(docType: DocType): DocTemplate[] {
  return DOC_TEMPLATES.filter((t) => t.docTypes.includes(docType));
}

export function templateCategories(docType: DocType): { category: string; templates: DocTemplate[] }[] {
  const filtered = templatesForDocType(docType);
  const categories: string[] = [];
  for (const t of filtered) {
    if (!categories.includes(t.category)) categories.push(t.category);
  }
  return categories.map((category) => ({
    category,
    templates: filtered.filter((t) => t.category === category),
  }));
}