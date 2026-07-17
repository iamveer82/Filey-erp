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
