import { addInterval, getCacheOrg, getCacheScope } from "./api";
import { requireAgentStorageScope } from "./agentStorage";
import { isLocalMode } from "./dataMode";
import { allocateDocumentNumber } from "./documentNumbers";
import { withLocalTransaction, localClient } from "./localdb";
import { loadDocFormats } from "./numberFormat";
import { notifyDataChanged } from "./realtime";
import { sb } from "./supabase";

const omit = (row: Record<string, unknown>, fields: string[]) => Object.fromEntries(Object.entries(row).filter(([key]) => !fields.includes(key)));
const day = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;

/** Draft and schedule commit together. The locked expected cycle, rather than
 * a newly generated ID, is the retry/concurrency identity for an occurrence. */
export async function generateRecurringInvoice(id: number, expected: string, today: string, nextRun: string): Promise<boolean> {
  const scope = requireAgentStorageScope(), account = getCacheScope(), org = getCacheOrg();
  if (!Number.isSafeInteger(id) || id <= 0 || !day(expected) || !day(today) || !day(nextRun) || expected > today || nextRun <= today)
    throw new Error("The recurring invoice schedule is invalid. Review its dates.");
  const check = () => requireAgentStorageScope(scope);
  let created = false;
  if (!isLocalMode()) {
    const client = sb();
    const { data: auth, error: authError } = await client.auth.getSession();
    check();
    if (authError || !auth.session || !account?.endsWith(`:user:${auth.session.user.id}`)) throw new Error("Your account changed. Reopen recurring invoices.");
    const { data, error } = await client.rpc("filey_generate_recurring_invoice", {
      p_id: id, p_expected: expected, p_today: today, p_next: nextRun,
      p_actor: auth.session.user.id, p_org: org,
    }).setHeader("Authorization", `Bearer ${auth.session.access_token}`);
    check();
    if (error) throw error;
    if (typeof data !== "boolean") throw new Error("Recurring generation could not be confirmed. Refresh its schedule before trying again.");
    created = data;
  } else {
    // Reserving before the document transaction avoids a nested queue. A lost
    // race can leave an unused number; it cannot create a second invoice.
    const { data: recurrence, error: readError } = await localClient.from("invoice_recurrence").select("*").eq("id", id).maybeSingle();
    if (readError) throw readError;
    check();
    if (!recurrence || !recurrence.active || recurrence.next_run !== expected) return false;
    const { data: base, error: baseError } = await localClient.from("invoice_docs").select("*").eq("id", recurrence.base_invoice_id).maybeSingle();
    if (baseError) throw baseError;
    const kind = base?.doc_type === "purchase" ? "purchase_invoice" : "invoice";
    const number = base ? await allocateDocumentNumber(kind, [], await loadDocFormats()) : null;
    created = await withLocalTransaction(async client => {
      check();
      const current = await client.from("invoice_recurrence").select("*").eq("id", id).maybeSingle();
      if (current.error) throw current.error;
      const schedule = current.data;
      if (!schedule || !schedule.active || schedule.next_run !== expected) return false;
      if (schedule.org_id && schedule.org_id !== org) throw new Error("The recurrence belongs to another workspace.");
      if (!["weekly", "monthly", "yearly"].includes(schedule.interval)) throw new Error("Choose a supported recurring interval.");
      let computed = schedule.next_run, steps = 0;
      do {
        computed = addInterval(computed, schedule.interval);
        if (++steps > 10000) throw new Error("The recurring schedule is outside the supported date range.");
      } while (computed <= today);
      if (computed !== nextRun) throw new Error("The recurring schedule changed. Refresh and retry.");
      const header = await client.from("invoice_docs").select("*").eq("id", schedule.base_invoice_id).maybeSingle();
      if (header.error) throw header.error;
      if (!header.data) {
        const retired = await client.from("invoice_recurrence").update({ active: false }).eq("id", id);
        if (retired.error) throw retired.error;
        return false;
      }
      if (header.data.id !== base?.id || !number) throw new Error("The recurring invoice changed. Refresh and retry.");
      if ((header.data.doc_type === "purchase" ? "purchase_invoice" : "invoice") !== kind) throw new Error("The recurring invoice type changed. Refresh and retry.");
      if (header.data.org_id && header.data.org_id !== org) throw new Error("The base invoice belongs to another workspace.");
      const lines = await client.from("invoice_doc_items").select("*").eq("invoice_id", header.data.id).order("position");
      if (lines.error) throw lines.error;
      if (lines.data.length > 500 || lines.data.some((line: Record<string, unknown>) => line.org_id && line.org_id !== org)) throw new Error("Review the recurring invoice's item ownership and size.");
      const copied = omit(header.data, ["id", "user_id", "org_id", "created_at", "updated_at", "sync_revision", "shared", "shared_with", "share_token", "due_date", "quotation_id", "order_id", "items"]);
      copied.org_id = org; copied.user_id = account?.split(":user:").slice(-1)[0];
      copied.number = number; copied.status = "draft"; copied.issue_date = today; copied.advance_applied = 0;
      if (copied.einvoice && typeof copied.einvoice === "object") copied.einvoice = { ...copied.einvoice, uuid: crypto.randomUUID() };
      const saved = await client.from("invoice_docs").insert(copied).select("id").single();
      if (saved.error) throw saved.error;
      for (const line of lines.data) {
        const inserted = await client.from("invoice_doc_items").insert({ ...omit(line, ["id", "user_id", "org_id", "created_at", "updated_at", "sync_revision", "shared", "shared_with"]), org_id: org, user_id: copied.user_id, invoice_id: saved.data.id });
        if (inserted.error) throw inserted.error;
      }
      const changed = await client.from("invoice_recurrence").update({ next_run: nextRun, last_run: today }).eq("id", id);
      if (changed.error) throw changed.error;
      check(); return true;
    }, { retrySafe: true });
  }
  check();
  if (created) notifyDataChanged();
  return created;
}
