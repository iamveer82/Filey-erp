// Write / confirm-gated / memory implementations for the channel agent.
// Split from tools.ts purely for file size — tools.ts holds the tool
// registry + dispatcher; this module holds the write-side machinery.
// The same WRITE POLICY and tenant-boundary rules documented in tools.ts
// apply here.

export const num = (v: unknown, d = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/** Suffix marks agent-created drafts; the owner renumbers on finalize if needed. */
export const draftNumber = (prefix: string) =>
  `${prefix}-${new Date().getFullYear()}-A${Math.floor(Math.random() * 9000) + 1000}`;

// deno-lint-ignore no-explicit-any
export async function logAgentAction(client: any, ownerId: string, action: string, entity: string, details: string) {
  try {
    await client.from("audit_log").insert({
      user_id: ownerId,
      actor: "agent",
      action,
      entity,
      details,
    });
  } catch (e) {
    console.error("agent audit log failed", e); // best-effort, never blocks
  }
}

/** remember { text, tag? } — upsert a durable memory for this user.
 *  De-dupes on lower(trim(text)): re-saving the same fact refreshes its
 *  updated_at (and tag) instead of creating a duplicate. Caps memory at 200
 *  rows per user, pruning the least-recently-updated. Fails SOFT with
 *  { error } if the agent_memories table doesn't exist yet. */
// deno-lint-ignore no-explicit-any
export async function rememberMemory(client: any, org: string, ownerId: string, input: any): Promise<unknown> {
  try {
    const text = String(input?.text ?? "").trim().slice(0, 500);
    if (!text) return { error: "text is required" };
    const tag = input?.tag ? String(input.tag).trim().slice(0, 40) || null : null;

    // De-dupe: same fact (case/whitespace-insensitive) → refresh, don't duplicate.
    const { data: existing, error: se } = await client
      .from("agent_memories")
      .select("id,text")
      .eq("user_id", ownerId);
    if (se) return { error: se.message }; // e.g. table missing — fail soft
    const key = text.toLowerCase();
    // deno-lint-ignore no-explicit-any
    const dupe = (existing ?? []).find((r: any) => String(r.text ?? "").trim().toLowerCase() === key);
    if (dupe) {
      const { error: ue } = await client
        .from("agent_memories")
        .update({ updated_at: new Date().toISOString(), ...(tag ? { tag } : {}) })
        .eq("id", dupe.id);
      if (ue) return { error: ue.message };
      return { remembered: true, refreshed: true };
    }

    const { error: ie } = await client
      .from("agent_memories")
      .insert({ user_id: ownerId, org_id: org, text, tag });
    if (ie) return { error: ie.message };

    // Prune: keep the 200 most recently updated memories per user.
    const { data: ids } = await client
      .from("agent_memories")
      .select("id")
      .eq("user_id", ownerId)
      .order("updated_at", { ascending: false });
    const stale = (ids ?? []).slice(200).map((r: { id: string }) => r.id);
    if (stale.length) {
      await client.from("agent_memories").delete().in("id", stale);
    }
    return { remembered: true };
  } catch (e) {
    return { error: String(e) }; // fail soft — never break a reply
  }
}

/** recall { query? } — the 8 newest memories, optionally filtered by an ilike
 *  on text/tag ([%,().] stripped so the term can't break the PostgREST or()).
 *  Fails SOFT with { error } if the table doesn't exist yet. */
// deno-lint-ignore no-explicit-any
export async function recallMemories(client: any, ownerId: string, input: any): Promise<unknown> {
  try {
    let q = client
      .from("agent_memories")
      .select("text,tag,updated_at")
      .eq("user_id", ownerId)
      .order("updated_at", { ascending: false })
      .limit(8);
    const term = String(input?.query ?? "").trim();
    if (term) {
      const safe = term.replace(/[%,().]/g, " ").trim().slice(0, 80);
      if (safe) q = q.or(`text.ilike.%${safe}%,tag.ilike.%${safe}%`);
    }
    const { data, error } = await q;
    if (error) return { error: error.message }; // e.g. table missing — fail soft
    return data ?? [];
  } catch (e) {
    return { error: String(e) };
  }
}

/** Create a pending payment-reminder action; the webhook executes it when the
 *  owner replies APPROVE <code>. Validates the invoice up front so the owner
 *  only ever approves something executable. */
// deno-lint-ignore no-explicit-any
export async function proposePaymentReminder(client: any, org: string, ownerId: string, input: any): Promise<unknown> {
  const number = String(input?.invoice_number ?? "").trim().slice(0, 60);
  if (!number) return { error: "invoice_number is required" };
  const { data: inv, error } = await client
    .from("invoice_docs")
    .select("id,number,customer_name,customer_email,due_date,status,currency")
    .eq("org_id", org)
    .eq("number", number)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!inv) return { error: `invoice ${number} not found` };
  if (inv.status === "paid" || inv.status === "draft")
    return { error: `invoice ${number} is ${inv.status} — no reminder needed/possible` };
  if (!inv.customer_email)
    return { error: `invoice ${number} has no customer email on file — add one in Filey first` };

  const code = String(Math.floor(Math.random() * 9000) + 1000);
  const { error: pe } = await client.from("agent_pending_actions").insert({
    user_id: ownerId,
    org_id: org,
    code,
    action: "send_payment_reminder",
    payload: {
      invoice_id: inv.id,
      number: inv.number,
      customer_name: inv.customer_name,
      customer_email: inv.customer_email,
      due_date: inv.due_date,
    },
  });
  if (pe) return { error: pe.message };
  return {
    proposed: "send_payment_reminder",
    invoice: inv.number,
    to: inv.customer_email,
    approval_code: code,
    note:
      `Tell the user: reply "APPROVE ${code}" to send the reminder to ` +
      `${inv.customer_email}, or "CANCEL ${code}" to drop it. Codes expire in 24h.`,
  };
}

// deno-lint-ignore no-explicit-any
export async function runWriteTool(
  // deno-lint-ignore no-explicit-any
  client: any,
  org: string,
  ownerId: string,
  name: string,
  // deno-lint-ignore no-explicit-any
  input: any,
): Promise<unknown> {
  // Service role bypasses column defaults tied to auth.uid()/current_org(),
  // so ownership is pinned explicitly on every insert.
  const owned = { user_id: ownerId, org_id: org };

  switch (name) {
    case "create_draft_invoice":
    case "create_draft_quote": {
      const isInvoice = name === "create_draft_invoice";
      // deno-lint-ignore no-explicit-any
      const items = (Array.isArray(input?.items) ? input.items : []).map((it: any) => ({
        description: String(it?.description ?? "").slice(0, 300),
        qty: Math.max(num(it?.qty, 1), 0.001),
        unit_price: Math.max(num(it?.unit_price), 0),
      }));
      if (!items.length) return { error: "at least one line item is required" };
      const number = draftNumber(isInvoice ? "INV" : "Q");
      const taxRate = isInvoice ? Math.min(Math.max(num(input?.tax_rate, 5), 0), 100) : 0;
      const head = {
        ...owned,
        number,
        status: "draft",
        currency: String(input?.currency ?? "AED").toUpperCase().slice(0, 3),
        customer_name: String(input?.customer_name ?? "").slice(0, 200),
        customer_email: input?.customer_email ? String(input.customer_email).slice(0, 200) : null,
        ...(isInvoice
          ? { doc_type: "invoice", tax_rate: taxRate, issue_date: new Date().toISOString().slice(0, 10) }
          : { quote_date: new Date().toISOString().slice(0, 10) }),
      };
      const table = isInvoice ? "invoice_docs" : "quotations";
      const { data: doc, error } = await client.from(table).insert(head).select("id").single();
      if (error) return { error: error.message };
      const itemTable = isInvoice ? "invoice_doc_items" : "quotation_items";
      const fk = isInvoice ? "invoice_id" : "quotation_id";
      const { error: ie } = await client.from(itemTable).insert(
        // deno-lint-ignore no-explicit-any
        items.map((it: any, i: number) => ({
          ...owned,
          [fk]: doc.id,
          description: it.description,
          qty: it.qty,
          unit_price: it.unit_price,
          position: i,
        })),
      );
      if (ie) return { error: ie.message };
      // deno-lint-ignore no-explicit-any
      const subtotal = items.reduce((s: number, it: any) => s + it.qty * it.unit_price, 0);
      const total = Math.round(subtotal * (1 + taxRate / 100) * 100) / 100;
      await logAgentAction(
        client,
        ownerId,
        name,
        `${table}:${doc.id}`,
        `${number} for ${head.customer_name} — ${head.currency} ${total}`,
      );
      return {
        created: "draft",
        number,
        total,
        currency: head.currency,
        note: "Draft saved in Filey — the owner reviews and finalizes it there.",
      };
    }

    case "create_draft_po": {
      // deno-lint-ignore no-explicit-any
      const items = (Array.isArray(input?.items) ? input.items : []).map((it: any) => ({
        description: String(it?.description ?? "").slice(0, 300),
        quantity: Math.max(num(it?.qty, 1), 0.001),
        unit_cost: Math.max(num(it?.unit_cost), 0),
      }));
      if (!items.length) return { error: "at least one line item is required" };
      const supplierName = String(input?.supplier_name ?? "").slice(0, 200);
      // Link the supplier when one matches by name (optional).
      let supplierId: number | null = null;
      try {
        const { data: sup } = await client
          .from("suppliers")
          .select("id")
          .eq("org_id", org)
          .ilike("name", `%${supplierName.replace(/[%,().]/g, " ")}%`)
          .limit(1)
          .maybeSingle();
        supplierId = sup?.id ?? null;
      } catch {
        /* optional linkage only */
      }
      const po_number = draftNumber("PO");
      // deno-lint-ignore no-explicit-any
      const total = items.reduce((s: number, it: any) => s + it.quantity * it.unit_cost, 0);
      const { data: po, error } = await client
        .from("purchase_orders")
        .insert({
          ...owned,
          po_number,
          status: "draft",
          supplier_id: supplierId,
          supplier_name: supplierName,
          currency: String(input?.currency ?? "AED").toUpperCase().slice(0, 3),
          total: Math.round(total * 100) / 100,
          order_date: new Date().toISOString().slice(0, 10),
        })
        .select("id")
        .single();
      if (error) return { error: error.message };
      const { error: ie } = await client.from("purchase_order_items").insert(
        // deno-lint-ignore no-explicit-any
        items.map((it: any, i: number) => ({ ...owned, po_id: po.id, ...it, position: i })),
      );
      if (ie) return { error: ie.message };
      await logAgentAction(
        client,
        ownerId,
        name,
        `purchase_orders:${po.id}`,
        `${po_number} to ${supplierName} — ${total}`,
      );
      return { created: "draft", number: po_number, total, note: "Draft PO saved in Filey." };
    }

    case "add_customer": {
      const row = {
        ...owned,
        name: String(input?.name ?? "").slice(0, 200),
        company: input?.company ? String(input.company).slice(0, 200) : null,
        email: input?.email ? String(input.email).slice(0, 200) : null,
        phone: input?.phone ? String(input.phone).slice(0, 50) : null,
      };
      if (!row.name) return { error: "customer name is required" };
      const { data, error } = await client.from("crm_customers").insert(row).select("id").single();
      if (error) return { error: error.message };
      await logAgentAction(client, ownerId, name, `crm_customers:${data.id}`, row.name);
      return { created: "customer", name: row.name };
    }

    case "add_product": {
      const row = {
        ...owned,
        name: String(input?.name ?? "").slice(0, 200),
        sku: input?.sku ? String(input.sku).slice(0, 80) : "",
        unit_price: Math.max(num(input?.unit_price), 0),
        cost_price: Math.max(num(input?.cost_price), 0),
        quantity: 0,
        reorder_level: Math.max(num(input?.reorder_level), 0),
      };
      if (!row.name) return { error: "product name is required" };
      const { data, error } = await client.from("products").insert(row).select("id").single();
      if (error) return { error: error.message };
      await logAgentAction(client, ownerId, name, `products:${data.id}`, row.name);
      return { created: "product", name: row.name, note: "Stock starts at 0 — receive stock in Filey." };
    }

    default:
      return { error: `unknown tool: ${name}` };
  }
}
