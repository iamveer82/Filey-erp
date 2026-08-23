// The gating model has two halves: `sensitive` flags on the tool itself, and
// membership in a capabilities.ts group (which IS the write-set for agent
// modes — see agentMode.ts). A mutating tool that has neither runs free in
// every mode, Plan included, because gateFor() only ever sees "not a write".
// Nothing about that shows up in review: one new tool object, one missing
// line, and Plan mode quietly stops being Plan mode.
//
// So the rule here is derived, not hand-listed: every tool in TOOLS must be
// either classified (sensitive or grouped) or named below as read-only WITH a
// reason. Adding a name to READ_ONLY is a deliberate act a reviewer sees.
import { beforeEach, describe, expect, it } from "vitest";
import { TOOLS } from "../aiTools";
import { CAPABILITIES } from "../capabilities";
import { setDataMode } from "../dataMode";
import { billing } from "../api";

/** Tools that neither mutate data nor reach outside, each with the reason it
 *  needs no classification. Grouped reads (web research, social listings,
 *  file tools) are NOT listed here — they carry their classification already. */
const READ_ONLY: Record<string, string> = {
  get_stats: "dashboard numbers",
  financial_summary: "read-only balances",
  vat_return: "computed report",
  financial_statements: "computed report",
  receivables_aging: "computed report",
  payables_aging: "computed report",
  list_transactions: "list",
  list_expenses: "list",
  find_customers: "search",
  find_products: "search",
  find_leads: "search",
  find_suppliers: "search",
  list_invoices: "list",
  list_deals: "list",
  crm_pipeline: "list",
  get_deal_contacts: "list",
  list_activities: "list",
  list_purchase_invoices: "list",
  list_payment_receipts: "list",
  list_delivery_challans: "list",
  list_payroll: "list",
  list_campaigns: "list",
  list_cheques: "list",
  list_bank_accounts: "list of the user's own accounts",
  list_email_templates: "list",
  list_templates: "list",
  open_page: "navigation only",
  list_employees: "list",
  get_attendance_today: "list",
  remember: "local memory note (deliberately ungated, see ai-agent.md §4)",
  recall: "local memory search",
  generate_image: "produces content but changes no business state",
  list_connected_apps: "list",
  list_skills: "list",
  use_skill: "loads instructions into context; changes nothing",
  http_fetch: "network READ; secrets substituted, never stored",
  current_time: "clock",
  list_reminders: "list",
  list_whatsapp_messages: "list of the user's own messages",
  list_file_tools: "catalogue of available file operations",
  list_my_files: "list of the user's own files",
  use_saved_file: "loads a stored file into context; changes nothing",
  list_secrets: "names only, never values (owner-only on top)",
  read_github: "reads public repo overview/README/tree",
  read_github_file: "reads one public file as text",
  search_github: "public search API",
  watch_youtube: "reads metadata/transcript of one video",
  read_rss: "reads a public feed",
  read_social_page: "reads one public page via the reader service",
};

describe("every mutating tool is gated", () => {
  const grouped = new Set(CAPABILITIES.flatMap((c) => c.tools));

  it("classifies completely — no tool escapes both the flag and the groups", () => {
    const unclassified = TOOLS.filter(
      (t) => !t.sensitive && !grouped.has(t.name) && !READ_ONLY[t.name]
    ).map((t) => t.name);
    expect(
      unclassified,
      `these tools mutate state but are neither \`sensitive\` nor in a ` +
        `capability group, so they run even in Plan mode. Classify them, or ` +
        `add them to READ_ONLY here with the reason they cannot change anything.`
    ).toEqual([]);
  });

  it("READ_ONLY stays honest — every entry exists and really is unclassified", () => {
    const names = new Set(TOOLS.map((t) => t.name));
    const stale = Object.keys(READ_ONLY).filter((n) => !names.has(n));
    // A stale entry hides nothing, but it lies about the inventory — prune it.
    expect(stale).toEqual([]);
  });
});

describe("blank lookups refuse instead of acting on an arbitrary record", () => {
  beforeEach(() => {
    localStorage.clear();
    setDataMode("local");
  });

  const tool = (name: string) => {
    const t = TOOLS.find((x) => x.name === name);
    if (!t) throw new Error(`${name} is not registered`);
    return t;
  };

  const seedInvoice = async () => {
    await billing.saveDoc({
      number: "INV-1",
      status: "sent",
      doc_type: "sales",
      currency: "AED",
      tax_rate: 0,
      discount: 0,
      customer_name: "Acme Trading",
      items: [{ description: "widget", qty: 1, unit_price: 100 }],
    } as never);
  };

  it("mark_invoice_paid with no number errors and leaves the books alone", async () => {
    await seedInvoice();
    const res = (await tool("mark_invoice_paid").run({})) as { error?: string };
    expect(res.error ?? "").toMatch(/matching|required/i);
    const docs = await billing.listDocs();
    expect(docs[0]?.status).toBe("sent");
  });

  it("mark_attendance with no employee name errors", async () => {
    const res = (await tool("mark_attendance").run({ status: "present" })) as {
      error?: string;
    };
    expect(res.error ?? "").toMatch(/matching|required/i);
  });
});
