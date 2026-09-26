import { sb } from "./supabase";
import { requireAgentStorageScope } from "./agentStorage";
import { notifyDataChanged } from "./realtime";
import type { Opportunity, CrmCustomer } from "./api";

export async function dealQuoteContext(id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Choose an existing deal.");
  const scope = requireAgentStorageScope(),
    client = sb();
  const { data, error } = await client
    .from("crm_opportunities")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) throw error || new Error("Deal unavailable.");
  const deal = data as Opportunity;
  if (!deal.customer_id)
    throw new Error("Choose a company on the deal before preparing a quotation.");
  const result = await client
    .from("crm_customers")
    .select("*")
    .eq("id", deal.customer_id)
    .single();
  if (result.error || !result.data)
    throw result.error || new Error("Company unavailable.");
  requireAgentStorageScope(scope);
  return { deal, customer: result.data as CrmCustomer };
}

/** Link only compatible records, and never overwrite a concurrent link. */
export async function linkDealQuotation(dealId: number, quoteId: number) {
  const scope = requireAgentStorageScope(),
    client = sb();
  const { deal } = await dealQuoteContext(dealId);
  if (!Number.isSafeInteger(quoteId) || quoteId <= 0)
    throw new Error("Save the quotation first.");
  if (deal.quotation_id && deal.quotation_id !== quoteId)
    throw new Error(
      "This deal already has a quotation. Open it from the deal's Documents tab."
    );
  const quote = await client
    .from("quotations")
    .select("id,customer_id")
    .eq("id", quoteId)
    .single();
  if (quote.error || !quote.data)
    throw quote.error || new Error("Quotation unavailable.");
  if (Number(quote.data.customer_id) !== deal.customer_id)
    throw new Error("The quotation and deal must belong to the same company.");
  requireAgentStorageScope(scope);
  if (deal.quotation_id === quoteId) return;
  const result = await client
    .from("crm_opportunities")
    .update({ quotation_id: quoteId })
    .eq("id", dealId)
    .is("quotation_id", null)
    .select("id")
    .single();
  if (result.error || !result.data)
    throw result.error || new Error("The deal changed. Reload it before linking.");
  requireAgentStorageScope(scope);
  notifyDataChanged();
}
