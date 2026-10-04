import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendChannelText } from "../channel-webhook/delivery.ts";
import { requireScheduledWorkspace } from "./scheduled-workspace.ts";

type Client = SupabaseClient;

const today = () => new Date().toISOString().slice(0, 10);
const aed = (n: number) => "AED " + Math.round(n).toLocaleString("en-AE");

type Account = { name: string; account_type: string; balance: number };
type Product = { name: string; quantity: number; reorder_level: number };
async function allRows<T>(supa: Client, table: string, columns: string, org: string) {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supa
      .from(table)
      .select(columns)
      .eq("org_id", org)
      .order("id")
      .range(offset, offset + 999)
      .returns<T[]>();
    if (error || !Array.isArray(data))
      throw new Error("Briefing data unavailable. Retry the scheduled job.");
    rows.push(...data);
    if (data.length < 1000) return { data: rows, error: null, count: null };
  }
}

/* ---------------- digest ---------------- */

export async function runDigest(supa: Client, org: string): Promise<string> {
  const t = today();
  const results = await Promise.all([
    allRows<Account>(supa, "accounts", "name,account_type,balance", org),
    supa
      .from("invoice_docs")
      .select("number,customer_name", { count: "exact" })
      .eq("org_id", org)
      .eq("doc_type", "invoice")
      .or("invoice_type_code.is.null,invoice_type_code.not.in.(381,81)")
      .eq("status", "sent")
      .eq("due_date", t)
      .limit(5),
    // Overdue: due date passed and still collectible — both the soft
    // "sent past due" rows and the explicit status='overdue' rows.
    supa
      .from("invoice_docs")
      .select("number,customer_name,due_date", { count: "exact" })
      .eq("org_id", org)
      .eq("doc_type", "invoice")
      .or("invoice_type_code.is.null,invoice_type_code.not.in.(381,81)")
      .or("status.eq.sent,status.eq.overdue")
      .lt("due_date", t)
      .not("status", "in", "(paid,draft,cancelled,void,voided,deleted)")
      .limit(10),
    allRows<Product>(supa, "products", "name,quantity,reorder_level", org),
  ]);
  if (results.some((result) => result.error))
    throw new Error("Briefing data unavailable. Retry the scheduled job.");
  const [
    { data: accounts },
    { data: due, count: dueCount },
    { data: overdue, count: overdueCount },
    { data: products },
  ] = results;

  const sum = (type: string) =>
    (accounts ?? [])
      .filter((a) => a.account_type === type)
      .reduce((s, a) => s + Number(a.balance || 0), 0);
  const low = (products ?? []).filter(
    (p: { quantity: number; reorder_level: number }) =>
      Number(p.reorder_level) > 0 && Number(p.quantity) <= Number(p.reorder_level)
  );

  const lines = [
    `☀️ Filey morning briefing — ${t}`,
    ``,
    `💰 Assets ${aed(sum("asset"))} · owed to you ~${aed(
      (accounts ?? [])
        .filter((a) => /receivable/i.test(a.name))
        .reduce((s, a) => s + Number(a.balance || 0), 0)
    )}`,
    `📄 Due today: ${dueCount ?? (due ?? []).length}` +
      ((due ?? []).length ? " — " + (due ?? []).map((d) => d.number).join(", ") : ""),
    `⚠️ Overdue: ${overdueCount ?? (overdue ?? []).length}` +
      ((overdue ?? []).length
        ? " — " +
          (overdue ?? [])
            .slice(0, 5)
            .map((d) => `${d.number} (${d.customer_name})`)
            .join(", ")
        : ""),
    `📦 Low stock: ${low.length}` +
      (low.length
        ? " — " +
          low
            .slice(0, 5)
            .map((p: { name: string }) => p.name)
            .join(", ")
        : ""),
  ];
  return lines.join("\n");
}

/* ---------------- low stock → draft POs ---------------- */

export async function runLowStockPo(
  supa: Client,
  org: string,
  owner: string
): Promise<string> {
  const { data, error } = await supa.rpc("filey_agent_lowstock_po", {
    p_owner: owner,
    p_org: org,
  });
  if (error || !Array.isArray(data))
    throw new Error("Purchase order drafts unavailable. Retry the scheduled job.");
  return data.length
    ? `🛒 Drafted ${data.length} purchase order(s) for low stock: ${data.map((po) => po.number + (po.supplier_name ? " → " + po.supplier_name : "")).join("; ")}. Review in Filey → Purchase Orders.`
    : "";
}

export async function tell(
  supa: Client,
  text: string,
  config: { owner: string; org: string; bot: string; chat: string }
): Promise<"sent" | "unconfigured"> {
  const { owner, org, bot, chat } = config;
  if (!bot || !chat) return "unconfigured";
  // Recheck after all digest/draft reads, against the original workspace.
  // The service-only RPC checks profile + membership in one SQL snapshot.
  await requireScheduledWorkspace(supa, owner, org);
  await sendChannelText("telegram", chat, text, { token: bot });
  // Audit is best effort; accepted delivery is never retried due to a log failure.
  try {
    const result = await supa
      .from("channel_messages")
      .insert({
        user_id: owner,
        channel: "telegram",
        external_id: chat,
        direction: "out",
        body: text,
        raw: { job: true },
      });
    if (result.error) console.error("Scheduled message audit unavailable");
  } catch {
    console.error("Scheduled message audit unavailable");
  }
  return "sent";
}
