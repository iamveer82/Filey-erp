import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { acceptedEmailId } from "./email-delivery.ts";
import { requireScheduledWorkspace } from "./scheduled-workspace.ts";

const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[<>&"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] ?? c
  );

export async function runReminders(
  supa: SupabaseClient,
  org: string,
  config: { owner: string; key: string; from: string; siteUrl: string },
  send: typeof fetch = fetch,
  today = new Date().toISOString().slice(0, 10)
) {
  const { owner, key, from, siteUrl } = config;
  let considered = 0,
    sent = 0,
    failed = 0;
  for (let offset = 0; ; offset += 1000) {
    // Purchase bills and credit notes are not debts owed by a customer.
    const { data, error } = await supa
      .from("invoice_docs")
      .select("id,number,customer_name,customer_email,due_date,share_token,shared")
      .eq("org_id", org)
      .eq("doc_type", "invoice")
      .or("invoice_type_code.is.null,invoice_type_code.not.in.(381,81)")
      .lt("due_date", today)
      .not("status", "in", "(paid,draft,cancelled,void,voided,deleted)")
      .order("id")
      .range(offset, offset + 999);
    if (error || !Array.isArray(data))
      throw new Error("Reminder data unavailable. Retry the scheduled job.");
    considered += data.length;
    for (const inv of data) {
      if (!inv.customer_email) continue;
      const link =
        inv.shared === true && inv.share_token && siteUrl
          ? `${siteUrl}/#/portal/${encodeURIComponent(inv.share_token)}`
          : "";
      const html = `<p>Dear ${esc(inv.customer_name || "customer")},</p>
        <p>This is a friendly reminder that invoice <b>${esc(inv.number)}</b> was due on ${esc(inv.due_date)} and is currently outstanding.</p>
        ${link ? `<p><a href="${esc(link)}">View invoice online</a></p>` : ""}<p>Thank you.</p>`;
      // Stop before publishing a recipient/number from an old workspace. Keep
      // this outside the provider-failure catch: loss of authority ends the job.
      await requireScheduledWorkspace(supa, owner, org);
      try {
        const response = await send("https://api.resend.com/emails", {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(20000),
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `filey-overdue/${owner}/${org}/${inv.id}/${today}`,
          },
          body: JSON.stringify({
            from,
            to: inv.customer_email,
            subject: `Reminder: invoice ${inv.number} is overdue`,
            html,
          }),
        });
        const receipt = await response.json().catch(() => null);
        if (response.ok && acceptedEmailId(receipt)) sent++;
        else failed++;
      } catch {
        failed++;
      }
    }
    if (data.length < 1000) return { considered, sent, failed };
  }
}
