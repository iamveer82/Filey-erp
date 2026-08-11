/* The document designs a customer can choose between.
 *
 * This lived inside Invoicing.tsx, which meant the agent had no way to see it:
 * asked for "the corporate template" it could only answer that it makes
 * invoices, because choosing a design was not something it could express. The
 * list now sits in lib so both the editor's picker and the agent's tools read
 * the same source, and a template added here is offered by both.
 */

export interface DocTemplate {
  id: string;
  name: string;
}

export const DOC_TEMPLATES: DocTemplate[] = [
  { id: "minimal", name: "Minimal" },
  { id: "fta", name: "UAE FTA Tax Invoice" },
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
  { id: "industrial", name: "Industrial" },
  { id: "executive", name: "Executive" },
  { id: "fresh", name: "Fresh" },
];

export const TEMPLATE_IDS = DOC_TEMPLATES.map((t) => t.id);

/** Resolve what a person actually typed to a template id: "the Corporate one",
 *  "green gold", "UAE professional". Returns undefined when nothing matches,
 *  so a caller can list the options rather than silently pick a default. */
export function resolveTemplate(input: string): string | undefined {
  const q = input.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (!q) return undefined;
  const byId = DOC_TEMPLATES.find((t) => t.id === q);
  if (byId) return byId.id;
  const byName = DOC_TEMPLATES.find((t) => t.name.toLowerCase() === input.trim().toLowerCase());
  if (byName) return byName.id;
  const partial = DOC_TEMPLATES.filter(
    (t) => t.id.includes(q) || t.name.toLowerCase().includes(input.trim().toLowerCase())
  );
  return partial.length === 1 ? partial[0].id : undefined;
}
