// Filey — scheduled agent jobs (Deno edge function). Phase 2 of the autonomy
// plan: the agent works without being asked.
//
//   • digest      — morning briefing to the owner's Telegram: cash position,
//                   due/overdue invoices, low stock.
//   • lowstock_po — draft purchase orders for products at/below reorder level,
//                   grouped by supplier (drafts only — owner reviews in Filey).
//
// Deploy:  supabase functions deploy agent-jobs --no-verify-jwt
// Secrets: AGENT_JOBS_SECRET (any long random string — REQUIRED, fail-closed),
//          TELEGRAM_BOT_TOKEN, TELEGRAM_OWNER_CHAT_ID, OWNER_USER_ID
//          (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY auto-provided.)
// Schedule (SQL, daily 08:00 Dubai = 04:00 UTC):
//   select cron.schedule('filey-agent-digest','0 4 * * *', $$
//     select net.http_post(
//       'https://<ref>.functions.supabase.co/agent-jobs',
//       '{"job":"all"}'::jsonb,
//       headers:='{"Content-Type":"application/json","x-agent-secret":"<AGENT_JOBS_SECRET>"}'::jsonb); $$);
//
// SECURITY: service-role client — every query pins org_id / user_id
// explicitly (same rule as channel-webhook/tools.ts). Writes are drafts only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OWNER = Deno.env.get("OWNER_USER_ID") ?? "";
const SECRET = Deno.env.get("AGENT_JOBS_SECRET") ?? "";
const BOT = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";

// deno-lint-ignore no-explicit-any
type Client = any;

const today = () => new Date().toISOString().slice(0, 10);
const aed = (n: number) =>
  "AED " + Math.round(n).toLocaleString("en-AE");

async function orgOf(supa: Client): Promise<string | null> {
  const { data } = await supa.from("profiles").select("org_id").eq("id", OWNER).maybeSingle();
  return data?.org_id ?? null;
}

async function tell(supa: Client, text: string): Promise<boolean> {
  if (!BOT) return false;
  // SECURITY: the digest contains financials — only ever send it to the
  // pinned owner chat (same TELEGRAM_OWNER_CHAT_ID the webhook requires).
  // Deriving it from the latest channel_messages row could pick a stranger.
  const chat = Deno.env.get("TELEGRAM_OWNER_CHAT_ID") ?? "";
  if (!chat) return false;
  const res = await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text }),
  });
  if (res.ok) {
    // Mirror into the conversation log the desktop app shows.
    try {
      await supa.from("channel_messages").insert({
        user_id: OWNER,
        channel: "telegram",
        external_id: chat,
        direction: "out",
        body: text,
        raw: { job: true },
      });
    } catch { /* best-effort */ }
  }
  return res.ok;
}

async function audit(supa: Client, action: string, entity: string, details: string) {
  try {
    await supa.from("audit_log").insert({ user_id: OWNER, actor: "agent", action, entity, details });
  } catch (e) {
    console.error("audit", e);
  }
}

/* ---------------- digest ---------------- */

async function runDigest(supa: Client, org: string): Promise<string> {
  const t = today();
  const [{ data: accounts }, { data: due }, { data: overdue }, { data: products }] =
    await Promise.all([
      supa.from("accounts").select("name,account_type,balance").eq("org_id", org),
      supa.from("invoice_docs").select("number,customer_name")
        .eq("org_id", org).eq("status", "sent").eq("due_date", t),
      supa.from("invoice_docs").select("number,customer_name,due_date")
        .eq("org_id", org).eq("status", "sent").lt("due_date", t).limit(10),
      supa.from("products").select("name,quantity,reorder_level").eq("org_id", org),
    ]);

  // deno-lint-ignore no-explicit-any
  const sum = (type: string) => (accounts ?? [])
    .filter((a: { account_type: string }) => a.account_type === type)
    // deno-lint-ignore no-explicit-any
    .reduce((s: number, a: any) => s + Number(a.balance || 0), 0);
  const low = (products ?? []).filter(
    (p: { quantity: number; reorder_level: number }) =>
      Number(p.reorder_level) > 0 && Number(p.quantity) <= Number(p.reorder_level),
  );

  const lines = [
    `☀️ Filey morning briefing — ${t}`,
    ``,
    `💰 Assets ${aed(sum("asset"))} · owed to you ~${aed(
      // deno-lint-ignore no-explicit-any
      (accounts ?? []).filter((a: any) => /receivable/i.test(a.name)).reduce((s: number, a: any) => s + Number(a.balance || 0), 0),
    )}`,
    `📄 Due today: ${(due ?? []).length}` +
      // deno-lint-ignore no-explicit-any
      ((due ?? []).length ? " — " + (due ?? []).map((d: any) => d.number).join(", ") : ""),
    `⚠️ Overdue: ${(overdue ?? []).length}` +
      // deno-lint-ignore no-explicit-any
      ((overdue ?? []).length ? " — " + (overdue ?? []).slice(0, 5).map((d: any) => `${d.number} (${d.customer_name})`).join(", ") : ""),
    `📦 Low stock: ${low.length}` +
      (low.length ? " — " + low.slice(0, 5).map((p: { name: string }) => p.name).join(", ") : ""),
  ];
  return lines.join("\n");
}

/* ---------------- low stock → draft POs ---------------- */

async function runLowStockPo(supa: Client, org: string): Promise<string> {
  const t = today();
  const [{ data: products }, { data: sups }, { data: existing }] = await Promise.all([
    supa.from("products")
      .select("id,name,quantity,reorder_level,cost_price,unit,supplier_id")
      .eq("org_id", org),
    supa.from("suppliers").select("id,name,address,email,phone,tax_id").eq("org_id", org),
    // Idempotence: one agent PO per supplier per day.
    supa.from("purchase_orders").select("supplier_id")
      .eq("org_id", org).eq("status", "draft")
      .eq("order_date", t).eq("notes", "Auto-created from low stock (agent)"),
  ]);
  const low = (products ?? []).filter(
    // deno-lint-ignore no-explicit-any
    (p: any) => Number(p.reorder_level) > 0 && Number(p.quantity) <= Number(p.reorder_level),
  );
  if (!low.length) return "";

  const doneToday = new Set((existing ?? []).map((r: { supplier_id: number | null }) => r.supplier_id ?? 0));
  // deno-lint-ignore no-explicit-any
  const bySupplier = new Map<number, any[]>();
  for (const p of low) {
    const sid = p.supplier_id ?? 0;
    if (doneToday.has(sid)) continue;
    const g = bySupplier.get(sid) ?? [];
    g.push(p);
    bySupplier.set(sid, g);
  }
  if (!bySupplier.size) return "";

  // deno-lint-ignore no-explicit-any
  const supById = new Map<number, any>((sups ?? []).map((s: any) => [s.id, s]));
  const created: string[] = [];
  for (const [sid, prods] of bySupplier) {
    const sup = supById.get(sid);
    const items = prods.map((p, i) => ({
      user_id: OWNER,
      org_id: org,
      description: p.name,
      // Refill to 2× reorder level — a draft the owner edits anyway.
      quantity: Math.max(1, Number(p.reorder_level) * 2 - Number(p.quantity)),
      unit_cost: Number(p.cost_price) || 0,
      unit: p.unit ?? undefined,
      position: i,
    }));
    const total = items.reduce((s, it) => s + it.quantity * it.unit_cost, 0);
    const po_number = `PO-${new Date().getFullYear()}-A${Math.floor(Math.random() * 9000) + 1000}`;
    const { data: po, error } = await supa
      .from("purchase_orders")
      .insert({
        user_id: OWNER,
        org_id: org,
        po_number,
        status: "draft",
        supplier_id: sid || null,
        supplier_name: sup?.name ?? "",
        supplier_address: sup?.address ?? "",
        supplier_email: sup?.email ?? "",
        supplier_phone: sup?.phone ?? "",
        supplier_trn: sup?.tax_id ?? "",
        currency: "AED",
        total: Math.round(total * 100) / 100,
        order_date: t,
        notes: "Auto-created from low stock (agent)",
      })
      .select("id")
      .single();
    if (error) {
      console.error("lowstock_po insert", error);
      continue;
    }
    const { error: ie } = await supa
      .from("purchase_order_items")
      .insert(items.map((it) => ({ ...it, po_id: po.id })));
    if (ie) {
      console.error("lowstock_po items", ie);
      continue;
    }
    await audit(supa, "agent.lowstock_po", `purchase_orders:${po.id}`, `${po_number} — ${sup?.name ?? "no supplier"} (${items.length} items)`);
    created.push(`${po_number}${sup?.name ? ` → ${sup.name}` : ""}`);
  }
  return created.length
    ? `🛒 Drafted ${created.length} purchase order(s) for low stock: ${created.join("; ")}. Review in Filey → Purchase Orders.`
    : "";
}

/* ---------------- dispatcher ---------------- */

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  if (!SECRET || req.headers.get("x-agent-secret") !== SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  if (!OWNER) return Response.json({ error: "OWNER_USER_ID not set" }, { status: 400 });

  let job = "all";
  try {
    const body = await req.json();
    if (typeof body?.job === "string") job = body.job;
  } catch { /* default */ }

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
  const org = await orgOf(supa);
  if (!org) return Response.json({ error: "owner org not found" }, { status: 400 });

  const out: Record<string, unknown> = {};
  const messages: string[] = [];

  if (job === "lowstock_po" || job === "all") {
    const msg = await runLowStockPo(supa, org);
    out.lowstock_po = msg || "nothing to reorder";
    if (msg) messages.push(msg);
  }
  if (job === "digest" || job === "all") {
    const msg = await runDigest(supa, org);
    out.digest = "built";
    messages.push(msg);
  }

  if (messages.length) {
    const sent = await tell(supa, messages.join("\n\n"));
    out.telegram = sent ? "sent" : "skipped (no bot/chat yet)";
  }
  return Response.json({ ok: true, job, ...out });
});
