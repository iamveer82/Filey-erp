// Write / confirm-gated / memory implementations for the channel agent.
// Split from tools.ts purely for file size — tools.ts holds the tool
// registry + dispatcher; this module holds the write-side machinery.
// The same WRITE POLICY and tenant-boundary rules documented in tools.ts
// apply here.

import { randomCode } from "./security.ts";
import type { InboundMsg } from "./parse.ts";

type ApprovalSource = Pick<InboundMsg, "channel" | "externalId">;
const approvalBinding = (source?: ApprovalSource) => source
  ? { approval_channel: source.channel, approval_chat_id: source.externalId }
  : {};

export const num = (v: unknown, d = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const MAX_CODE_ATTEMPTS = 5;

const unconfirmedWrite = {
  error: "Save was not confirmed. Check Filey before retrying; a record may already have been saved. Do not repeat this write automatically.",
  code: "unconfirmed_write",
  retry_safe: false,
} as const;

// Only known field-validation messages may reach chat. Other database details
// remain private, and only a definitive transaction rejection is retryable.
const draftValidationMessages = new Set([
  "Multiple company profiles require review in Filey",
  "Multiple customers match this name. Choose the customer in Filey",
  "Invoice dates must be YYYY-MM-DD", "Invoice dates must be real calendar dates",
  "Invoice notes and terms must be text within 4096 characters",
  "Invalid invoice calculation fields", "Invalid invoice custom column",
  "Choose an existing unique invoice pricing column",
  "Company currency or tax defaults need review in Filey",
  "Invoice tax rate has unsupported precision; use at most three decimals",
  "Draft quantity or price has unsupported precision", "Invalid draft quantity or price",
  "Invalid invoice unit or calculation fields", "Every invoice line needs a numeric pricing multiplier",
  "Invoice pricing multiplier is too large", "Draft total is too large",
  "Unsupported invoice custom field. Keep the original values and use Filey to review this invoice",
]);

/** An insert can commit before its response is lost. Only a usable row ID
 *  is a receipt; transport failure or malformed success is not a safe retry. */
// deno-lint-ignore no-explicit-any
async function insertRecord(client: any, table: string, row: Record<string, unknown>): Promise<{ id: string | number } | typeof unconfirmedWrite> {
  try {
    const { data, error } = await client.from(table).insert(row).select("id").single();
    const id = data?.id;
    if (error || !(typeof id === "string" && id.trim() || typeof id === "number" && Number.isSafeInteger(id) && id > 0)) {
      console.error("channel record save", table, error?.code ?? "invalid_result");
      return unconfirmedWrite;
    }
    return { id };
  } catch {
    console.error("channel record save", table, "response_unconfirmed");
    return unconfirmedWrite;
  }
}

/** Insert a pending action under a fresh CSPRNG approval code, retrying when
 *  the draw collides with another LIVE code for this user (the partial unique
 *  index from 2026-08-22-agent-hardening.sql makes the DB the tiebreaker).
 *  Math.random codes are gone: a guessable approval code is a remote-execution
 *  primitive on someone's books. Every insert also stamps a 24h expires_at so
 *  old rows can be pruned without guessing at created_at semantics. */
export async function insertPendingAction(
  // deno-lint-ignore no-explicit-any
  client: any,
  // deno-lint-ignore no-explicit-any
  base: any,
): Promise<{ ok: true; code: string } | { ok: false; error: string; code?: string; retry_safe?: false }> {
  let lastMsg = "could not allocate an approval code";
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = randomCode(4);
    try {
      const { error } = await client.from("agent_pending_actions").insert({
        ...base,
        code,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
      if (!error) return { ok: true, code };
      lastMsg = String(error.message ?? error);
      // Only a confirmed unique-code collision is safe to try again.
      if ((error as { code?: string }).code !== "23505") return { ok: false, ...unconfirmedWrite };
    } catch {
      return { ok: false, ...unconfirmedWrite };
    }
  }
  return { ok: false, error: lastMsg };
}

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
    const text = String(input?.text ?? "").trim();
    if (!text) return { error: "text is required" };
    if (text.length > 500) return { error: "Keep each memory within 500 characters." };
    const tag = input?.tag ? String(input.tag).trim().slice(0, 40) || null : null;

    // De-dupe: same fact (case/whitespace-insensitive) → refresh, don't duplicate.
    const { data: existing, error: se } = await client
      .from("agent_memories")
      .select("id,text")
      .eq("user_id", ownerId).eq("org_id", org);
    if (se) return { error: se.message }; // e.g. table missing — fail soft
    const key = text.toLowerCase();
    const replaceId = String(input?.replace_id ?? "").trim();
    // deno-lint-ignore no-explicit-any
    const dupe = (existing ?? []).find((r: any) => replaceId ? r.id === replaceId : String(r.text ?? "").trim().toLowerCase() === key);
    if (replaceId && !dupe) return { error: "Memory not found. Recall it again before correcting it." };
    if (dupe) {
      const { error: ue } = await client
        .from("agent_memories")
        .update({ text, updated_at: new Date().toISOString(), ...(tag ? { tag } : {}) })
        .eq("user_id", ownerId)
        .eq("org_id", org)
        .eq("id", dupe.id);
      if (ue) return { error: ue.message };
      return { remembered: true, refreshed: true, id: dupe.id };
    }

    const { error: ie } = await client
      .from("agent_memories")
      .insert({ user_id: ownerId, org_id: org, text, tag });
    if (ie) return { error: ie.message };

    // Prune only this workspace; another company's facts are independent.
    const { data: ids } = await client
      .from("agent_memories")
      .select("id")
      .eq("user_id", ownerId)
      .eq("org_id", org)
      .order("updated_at", { ascending: false });
    const stale = (ids ?? []).slice(200).map((r: { id: string }) => r.id);
    if (stale.length) {
      await client.from("agent_memories").delete().eq("user_id", ownerId).eq("org_id", org).in("id", stale);
    }
    return { remembered: true };
  } catch (e) {
    return { error: String(e) }; // fail soft — never break a reply
  }
}

/** recall { query? } — rank up to 200 owner-scoped memories locally, return 8.
 *  Fails SOFT with { error } if the table doesn't exist yet. */
// deno-lint-ignore no-explicit-any
export async function recallMemories(client: any, org: string, ownerId: string, input: any): Promise<unknown> {
  try {
    const q = client
      .from("agent_memories")
      .select("id,text,tag,updated_at")
      .eq("user_id", ownerId)
      .eq("org_id", org)
      .order("updated_at", { ascending: false })
      .limit(200);
    const term = String(input?.query ?? "").trim();
    const { data, error } = await q;
    if (error) return { error: error.message }; // e.g. table missing — fail soft
    return rankMemories(data ?? [], term).slice(0, 8);
  } catch (e) {
    return { error: String(e) };
  }
}

/** Bounded, multilingual retrieval; no remote embeddings or extra model call. */
export function rankMemories<T extends { text: string; tag?: string | null }>(rows: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  const terms = [...new Set(q.match(/[\p{L}\p{N}\p{M}]+/gu) ?? [])].filter((t) => t.length > 2);
  return rows.map((row, index) => {
    const text = `${row.text} ${row.tag ?? ""}`.toLowerCase();
    const score = (text.includes(q) ? 10 : 0) + terms.filter((t) => text.includes(t)).length;
    return { row, index, score };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).map((r) => r.row);
}

/** Create a pending payment-reminder action; the webhook executes it when the
 *  owner replies APPROVE <code>. Validates the invoice up front so the owner
 *  only ever approves something executable. */
// deno-lint-ignore no-explicit-any
export async function proposePaymentReminder(client: any, org: string, ownerId: string, input: any, source?: ApprovalSource): Promise<unknown> {
  const number = String(input?.invoice_number ?? "").trim();
  if (!number) return { error: "invoice_number is required" };
  if (number.length > 160 || [...number].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return { error: "Use the complete saved invoice number, up to 160 characters without control characters." };
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

  const res = await insertPendingAction(client, {
    user_id: ownerId,
    org_id: org,
    action: "send_payment_reminder",
    payload: {
      ...approvalBinding(source),
      invoice_id: inv.id,
      number: inv.number,
      customer_name: inv.customer_name,
      customer_email: inv.customer_email,
      due_date: inv.due_date,
    },
  });
  if (!res.ok) return res;
  return {
    proposed: "send_payment_reminder",
    invoice: inv.number,
    to: inv.customer_email,
    approval_code: res.code,
    note:
      `Tell the user: reply "APPROVE ${res.code}" to send the reminder to ` +
      `${inv.customer_email}, or "CANCEL ${res.code}" to drop it. Codes expire in 24h.`,
  };
}

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
    case "create_draft_quote":
    case "create_draft_po": {
      const kind = name === "create_draft_invoice" ? "invoice" : name === "create_draft_quote" ? "quote" : "po";
      // An atomic save can commit before its response is lost. Never turn an
      // unconfirmed RPC into a claim that nothing was saved or a safe retry.
      try {
        const { data, error } = await client.rpc("filey_channel_create_draft", {
          p_owner: ownerId, p_org: org, p_kind: kind, p_input: input,
        });
        if (error?.code === "22023") return {
          error: `${draftValidationMessages.has(error.message) ? error.message : "The draft fields need review in Filey"}. No draft was saved by this action.`,
          code: "invalid_arguments", save_outcome: "rejected", retry_safe: true,
        };
        if (error || data?.created !== "draft" || !data?.id || !data?.number) {
          console.error("channel draft save", error?.code ?? "invalid_result");
          return unconfirmedWrite;
        }
        return data;
      } catch {
        console.error("channel draft save", "response_unconfirmed");
        return unconfirmedWrite;
      }
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
      const result = await insertRecord(client, "crm_customers", row);
      if ("error" in result) return result;
      await logAgentAction(client, ownerId, name, `crm_customers:${result.id}`, row.name);
      return { created: "customer", id: result.id, name: row.name };
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
      const result = await insertRecord(client, "products", row);
      if ("error" in result) return result;
      await logAgentAction(client, ownerId, name, `products:${result.id}`, row.name);
      return { created: "product", id: result.id, name: row.name, note: "Stock starts at 0 — receive stock in Filey." };
    }

    case "log_expense": {
      // Additive record in the expenses table — same class of write as
      // add_customer: reversible by deleting the row, nothing modified.
      const row = {
        ...owned,
        category: String(input?.category ?? "").trim().slice(0, 80),
        description: input?.description ? String(input.description).slice(0, 300) : null,
        amount: num(input?.amount),
        expense_date:
          typeof input?.expense_date === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(input.expense_date)
            ? input.expense_date
            : new Date().toISOString().slice(0, 10),
      };
      if (!row.category) return { error: "category is required" };
      if (!(row.amount > 0)) return { error: "amount must be greater than zero" };
      const result = await insertRecord(client, "expenses", row);
      if ("error" in result) return result;
      await logAgentAction(
        client,
        ownerId,
        name,
        `expenses:${result.id}`,
        `${row.category} — ${row.amount} on ${row.expense_date}`,
      );
      return { created: "expense", id: result.id, category: row.category, amount: row.amount };
    }

    default:
      return { error: `unknown tool: ${name}` };
  }
}

/** connect_channel { provider, token, ... } — propose wiring up a NEW chat
 *  channel. Nothing is written to agent_channels here: this only parks the
 *  credentials on a pending action, because connecting a channel decides who
 *  can talk to the books and must cross the same APPROVE gate as sending money
 *  out. The approval handler in index.ts does the real work. */
// deno-lint-ignore no-explicit-any
export async function proposeConnectChannel(client: any, ownerId: string, input: any, source?: ApprovalSource): Promise<unknown> {
  const provider = String(input?.provider ?? "").trim().toLowerCase();
  if (!["telegram", "whatsapp", "slack"].includes(provider))
    return { error: "provider must be telegram, whatsapp or slack" };
  const token = String(input?.token ?? "").trim();
  if (!token) return { error: "token is required" };
  if (provider === "whatsapp" && !String(input?.phone_number_id ?? "").trim())
    return { error: "whatsapp also needs phone_number_id" };
  if (provider === "whatsapp" && !String(input?.app_secret ?? "").trim())
    return { error: "whatsapp also needs app_secret to verify incoming messages" };
  if (provider === "slack" && !String(input?.signing_secret ?? "").trim())
    return { error: "slack also needs signing_secret to verify incoming messages" };

  const res = await insertPendingAction(client, {
    user_id: ownerId,
    org_id: "default",
    action: "connect_channel",
    payload: {
      ...approvalBinding(source),
      provider,
      token,
      phone_number_id: String(input?.phone_number_id ?? "").trim() || null,
      signing_secret: String(input?.signing_secret ?? "").trim() || null,
      app_secret: String(input?.app_secret ?? "").trim() || null,
    },
  });
  if (!res.ok) return res;
  return {
    proposed: "connect_channel",
    provider,
    code: res.code,
    note:
      `Nothing is connected yet. Tell the owner to reply "APPROVE ${res.code}" ` +
      `to wire up ${provider}.`,
  };
}

/** send_message { channel, to | customer_name, text } — propose sending a chat
 *  message out to someone who is NOT the owner. Confirm-gated for the obvious
 *  reason: this is the agent talking to your customers in your name, and a
 *  wrong number or a wrong draft is not retractable once delivered. */
// deno-lint-ignore no-explicit-any
export async function proposeSendMessage(client: any, org: string, ownerId: string, input: any, source?: ApprovalSource): Promise<unknown> {
  const channel = String(input?.channel ?? "").trim().toLowerCase();
  if (!["whatsapp", "telegram", "slack"].includes(channel))
    return { error: "channel must be whatsapp, telegram or slack" };
  const text = String(input?.text ?? "").trim().slice(0, 4000);
  if (!text) return { error: "text is required" };

  let to = String(input?.to ?? "").trim();
  let who = to;
  const lookup = String(input?.customer_name ?? "").trim();
  if (!to && lookup) {
    const { data, error } = await client
      .from("crm_customers")
      .select("name,company,phone")
      .eq("org_id", org)
      .ilike("name", `%${lookup.replace(/[%_,()]/g, "")}%`)
      .limit(2);
    if (error) return { error: error.message };
    if (!data?.length) return { error: `no customer matching "${lookup}"` };
    if (data.length > 1)
      return { error: `"${lookup}" matches more than one customer — be specific or pass \`to\`` };
    if (!data[0].phone)
      return { error: `${data[0].company || data[0].name} has no phone on file` };
    to = String(data[0].phone);
    who = `${data[0].company || data[0].name} (${to})`;
  }
  if (!to) return { error: "give either `to` or `customer_name`" };

  const res = await insertPendingAction(client, {
    user_id: ownerId,
    org_id: org,
    action: "send_message",
    payload: { channel, to, who, text, ...approvalBinding(source) },
  });
  if (!res.ok) return res;
  return {
    proposed: "send_message",
    channel,
    to: who,
    code: res.code,
    note:
      `Nothing sent yet. Show the owner the exact text and recipient, then ` +
      `tell them to reply "APPROVE ${res.code}" to send it.`,
  };
}
