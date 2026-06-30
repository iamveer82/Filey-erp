// Read-only ERP data tools for the channel agent.
//
// SECURITY: the caller passes a *service-role* Supabase client, which bypasses
// RLS. The `.eq("org_id", org)` on every query is therefore the ONLY thing
// preventing cross-tenant reads. Never remove it. These tools READ ONLY — no
// insert/update/delete is exposed here yet (writes need explicit confirmation;
// see the webhook security notes).

export type ToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export const TOOLS: ToolDef[] = [
  {
    name: "get_financial_summary",
    description:
      "Current accounting balances: receivables (money owed to you), payables " +
      "(money you owe), cash/bank, income and expense accounts. Use for cash " +
      "position, what you're owed, revenue or expense questions. Amounts are in " +
      "the account currency (AED unless stated).",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_invoices",
    description:
      "List recent invoices, newest first. Optionally filter by status: 'draft', " +
      "'sent', 'paid', or 'overdue' (sent and past due date). Use for questions " +
      "about specific invoices, who hasn't paid, or recent billing.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["draft", "sent", "paid", "overdue"],
          description: "Filter by invoice status.",
        },
        limit: {
          type: "integer",
          description: "Max invoices to return (default 10, max 25).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_low_stock",
    description:
      "Products at or below their reorder level — what needs restocking. Use for " +
      "inventory and reorder questions.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "find_customer",
    description:
      "Search customers by name or company (partial match). Returns contact " +
      "details. Use to look up a customer's email, phone or segment.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Name or company to search for." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
];

// deno-lint-ignore no-explicit-any
export async function runTool(
  // deno-lint-ignore no-explicit-any
  client: any,
  orgId: string,
  name: string,
  // deno-lint-ignore no-explicit-any
  input: any,
): Promise<unknown> {
  const org = String(orgId);
  switch (name) {
    case "get_financial_summary": {
      const { data, error } = await client
        .from("accounts")
        .select("name,account_type,balance")
        .eq("org_id", org);
      if (error) return { error: error.message };
      return (data ?? [])
        // deno-lint-ignore no-explicit-any
        .map((a: any) => ({ name: a.name, type: a.account_type, balance: Number(a.balance) }))
        // deno-lint-ignore no-explicit-any
        .filter((a: any) => a.balance !== 0);
    }
    case "list_invoices": {
      const limit = Math.min(Math.max(Number(input?.limit) || 10, 1), 25);
      const status = typeof input?.status === "string" ? input.status : undefined;
      let q = client
        .from("invoice_docs")
        .select("number,customer_name,status,issue_date,due_date,currency")
        .eq("org_id", org)
        .order("issue_date", { ascending: false })
        .limit(limit);
      if (status === "overdue") {
        const today = new Date().toISOString().slice(0, 10);
        q = q.eq("status", "sent").lt("due_date", today);
      } else if (status) {
        q = q.eq("status", status);
      }
      const { data, error } = await q;
      if (error) return { error: error.message };
      return data ?? [];
    }
    case "list_low_stock": {
      const { data, error } = await client
        .from("products")
        .select("sku,name,quantity,reorder_level")
        .eq("org_id", org);
      if (error) return { error: error.message };
      return (data ?? [])
        // deno-lint-ignore no-explicit-any
        .filter((p: any) => Number(p.reorder_level) > 0 && Number(p.quantity) <= Number(p.reorder_level))
        // deno-lint-ignore no-explicit-any
        .map((p: any) => ({
          sku: p.sku,
          name: p.name,
          quantity: Number(p.quantity),
          reorder_level: Number(p.reorder_level),
        }))
        .slice(0, 50);
    }
    case "find_customer": {
      const term = String(input?.query ?? "").trim();
      if (!term) return [];
      // Strip characters that have meaning in a PostgREST or() filter so a chat
      // message can't break out of the ilike pattern.
      const safe = term.replace(/[%,().]/g, " ").slice(0, 80);
      const { data, error } = await client
        .from("crm_customers")
        .select("name,company,email,phone,segment")
        .eq("org_id", org)
        .or(`name.ilike.%${safe}%,company.ilike.%${safe}%`)
        .limit(10);
      if (error) return { error: error.message };
      return data ?? [];
    }
    default:
      return { error: `unknown tool: ${name}` };
  }
}
