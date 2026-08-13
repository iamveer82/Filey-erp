// Per-document-type presets: the template a new document starts on, so the
// user picks it once instead of on every invoice, quote, PO and receipt.
//
// company_profile.default_template was already doing this job for invoices,
// quotes and POs — one setting shared by three document types that don't share
// a template list, which is why receipts hardcoded "receipt" and ignored it.
// These presets are per type; default_template stays as the seed value and the
// fallback, so nothing an existing profile already set is lost.
import { tools } from "./api";
import { resolveTemplateId, templatesForDocType, type DocType } from "../components/DocTemplates";

const SETTING_KEY = "doc_presets";

export type DocPresets = Partial<Record<DocType, string>>;

/** Labels for the document types, for preset UI. */
export const DOC_TYPE_LABELS: Record<DocType, string> = {
  invoice: "Invoices",
  quote: "Quotations",
  po: "Purchase orders",
  receipt: "Payment receipts",
};

export const DOC_TYPES: DocType[] = ["invoice", "quote", "po", "receipt"];

export async function loadDocPresets(): Promise<DocPresets> {
  try {
    const rows = await tools.settings();
    const row = rows.find((r) => r.key === SETTING_KEY);
    if (!row?.value) return {};
    return JSON.parse(row.value) as DocPresets;
  } catch (e) {
    console.warn("Failed to parse document presets", e);
    return {};
  }
}

export async function saveDocPresets(p: DocPresets): Promise<void> {
  await tools.setSetting(SETTING_KEY, JSON.stringify(p));
}

/** Set one type's preset without disturbing the others. */
export async function saveDocPreset(docType: DocType, template: string): Promise<DocPresets> {
  const next = { ...(await loadDocPresets()), [docType]: template };
  await saveDocPresets(next);
  return next;
}

/** The template a new document of this type should open on: the preset, then
 *  the company's default_template if it names a template this type actually
 *  has, then the caller's own fallback. */
export function presetTemplate(
  presets: DocPresets,
  docType: DocType,
  companyDefault: string | undefined,
  fallback: string
): string {
  const preset = presets[docType];
  if (preset) return resolveTemplateId(preset);
  if (companyDefault) {
    const id = resolveTemplateId(companyDefault);
    if (templatesForDocType(docType).some((t) => t.id === id)) return id;
  }
  return fallback;
}
