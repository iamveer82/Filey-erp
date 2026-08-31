/* The link graph.
 *
 * Filey's modules already hold the objects a business cares about, but nothing
 * connects them: an invoice does not know which quotation became it, a
 * follow-up does not know which purchase order triggered it, and the one
 * existing cross-reference (crm_activities.related_to) stores a *name*, so
 * renaming a customer orphans its history.
 *
 * This is the vocabulary for a generic edge between any two records. The edge
 * itself lives in entity_links and is read in both directions, so linking A→B
 * makes B show A without a second row.
 */

/** Every record type that can sit at either end of a link. Adding a module
 *  means adding it here — the database deliberately does not constrain the
 *  type, so this list is the single source of truth for the vocabulary. */
export const ENTITY_TYPES = [
  "invoice",
  "quotation",
  "purchase_order",
  "customer",
  "supplier",
  "product",
  "lead",
  "follow_up",
  "receipt",
  "expense",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

/** Table each type reads from. Kept beside the vocabulary so a link can be
 *  resolved back to a real row without every caller knowing the mapping. */
export const ENTITY_TABLE: Record<EntityType, string> = {
  invoice: "invoice_docs",
  quotation: "quotations",
  purchase_order: "purchase_orders",
  customer: "crm_customers",
  supplier: "suppliers",
  product: "products",
  lead: "crm_leads",
  follow_up: "follow_ups",
  receipt: "payment_receipts",
  expense: "expenses",
};

/** Column that carries the human-readable label for each type. Invoices and
 *  quotes are known by their number; people and things by their name. */
export const ENTITY_LABEL_COL: Record<EntityType, string> = {
  invoice: "number",
  quotation: "number",
  purchase_order: "number",
  customer: "name",
  supplier: "name",
  product: "name",
  lead: "name",
  follow_up: "title",
  receipt: "number",
  expense: "description",
};

/** What to call each type in the interface. */
export const ENTITY_LABEL: Record<EntityType, string> = {
  invoice: "Invoice",
  quotation: "Quotation",
  purchase_order: "Purchase order",
  customer: "Customer",
  supplier: "Supplier",
  product: "Product",
  lead: "Lead",
  follow_up: "Follow-up",
  receipt: "Receipt",
  expense: "Expense",
};

/** In-app route for a linked record, so a backlink is clickable rather than
 *  decorative. Types without a detail page of their own land on their list. */
export function entityHref(type: EntityType, id: number): string {
  switch (type) {
    case "customer":
      return `/customers/${id}`;
    case "supplier":
      return `/suppliers/${id}`;
    case "invoice":
      return `/invoicing?doc=${id}`;
    case "quotation":
      return `/quoting?doc=${id}`;
    case "purchase_order":
      return `/purchase?po=${id}`;
    case "product":
      return `/inventory?product=${id}`;
    case "lead":
      return `/crm?lead=${id}`;
    case "follow_up":
      return `/follow-ups?id=${id}`;
    case "receipt":
      return `/receipts?id=${id}`;
    case "expense":
      return `/expenses?id=${id}`;
  }
}

export function isEntityType(v: string): v is EntityType {
  return (ENTITY_TYPES as readonly string[]).includes(v);
}

/** One edge, already resolved to something renderable. `direction` records
 *  which side the record being viewed was on, so the UI can word it. */
export interface LinkedRecord {
  linkId: number;
  type: EntityType;
  id: number;
  label: string;
  kind: string;
  note?: string;
  direction: "outgoing" | "incoming";
  created_at: string;
}
