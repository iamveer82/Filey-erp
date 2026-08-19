// Which tools the model is shown, and when.
//
// All 89 tools used to go out on every request, on every round of a run that
// can take 16 of them. Their descriptions alone are ~3,900 tokens, and with the
// JSON schemas the real figure is several times that — paid on every call. Cost
// is the smaller half of the problem: 89 near-neighbours is well past the point
// where a model reliably picks the right one, and a mis-picked tool is a wrong
// invoice, not a wasted round.
//
// So: a core set that covers the overwhelming majority of turns goes out
// always, and the rest arrive when the model asks for them by domain. The model
// is told the domains exist, which is what makes the ask possible.
//
// ponytail: a hand-kept map, not inference from the tool names. Names are not a
// taxonomy (`run_payroll` is HR, `run_shell` is system) and a wrong guess here
// hides a tool the agent needed. The test asserts the map covers TOOLS exactly,
// so adding a tool without placing it fails the build rather than silently
// dropping it out of reach.

/** Always offered. Reads, navigation, memory, and the drafts asked for daily. */
export const CORE_TOOLS = [
  // orientation
  "get_stats",
  "current_time",
  "open_page",
  // looking things up
  "find_customers",
  "find_products",
  "find_suppliers",
  "list_invoices",
  "financial_summary",
  // the documents people ask for by name
  "create_invoice_draft",
  // Correcting a draft is as everyday as making one, and keeping it out of the
  // core set is what makes an agent produce a second invoice instead of fixing
  // the first.
  "revise_invoice",
  "create_quote",
  "create_customer",
  "create_product",
  "list_templates",
  // memory and procedure
  "remember",
  "recall",
  "list_skills",
  "use_skill",
  // reach for more
  "list_toolsets",
  "use_toolset",
] as const;

/** Everything else, by the domain a person would name. */
export const TOOLSETS: Record<string, { about: string; tools: string[] }> = {
  sales: {
    about: "Send invoices, mark them paid, recurring billing, orders, receipts, templates",
    tools: [
      "send_invoice",
      "email_invoice",
      "mark_invoice_paid",
      "set_recurring",
      "set_invoice_template",
      "create_order",
      "create_payment_receipt",
      "list_payment_receipts",
      "share_document_link",
    ],
  },
  purchasing: {
    about: "Purchase orders, supplier bills, suppliers",
    tools: [
      "create_purchase_order",
      "create_purchase_invoice_draft",
      "list_purchase_invoices",
      "create_supplier",
    ],
  },
  inventory: {
    about: "Stock levels and adjustments",
    tools: ["adjust_stock"],
  },
  logistics: {
    about: "Delivery challans, goods received notes and returns — what physically moved, to whom",
    tools: ["create_delivery_challan", "list_delivery_challans"],
  },
  accounting: {
    about: "Ledger, VAT, cheques, banks, expenses, ageing and statements",
    tools: [
      "log_expense",
      "list_expenses",
      "list_transactions",
      "list_bank_accounts",
      "list_cheques",
      "record_cheque",
      "financial_statements",
      "receivables_aging",
      "payables_aging",
      "vat_return",
    ],
  },
  crm: {
    about: "Leads, deals, pipeline and activity history",
    tools: [
      "create_lead",
      "find_leads",
      "create_deal",
      "set_deal_stage",
      "list_deals",
      "crm_pipeline",
      "log_activity",
      "list_activities",
      "score_lead",
    ],
  },
  people: {
    about: "Employees, attendance, payroll and WPS",
    tools: [
      "list_employees",
      "mark_attendance",
      "get_attendance_today",
      "run_payroll",
      "list_payroll",
      "generate_wps_file",
    ],
  },
  files: {
    about: "Read, edit and convert PDFs and images; saved files",
    tools: [
      "run_file_tool",
      "list_file_tools",
      "read_attached_document",
      "use_saved_file",
      "list_my_files",
      "generate_image",
    ],
  },
  messaging: {
    about: "Email, WhatsApp, connected apps and campaigns",
    tools: [
      "send_gmail",
      "send_whatsapp",
      "list_whatsapp_messages",
      "connect_whatsapp",
      "composio_run",
      "list_connected_apps",
      "list_email_templates",
      "create_campaign",
      "list_campaigns",
    ],
  },
  web: {
    about: "Read and search the public web, research companies and prospects",
    tools: [
      "read_web_page",
      "search_web",
      "http_fetch",
      "enrich_company_website",
      "find_prospects",
      "browser",
    ],
  },
  social: {
    about: "Post and schedule to connected social accounts",
    tools: ["list_social_accounts", "schedule_social_post", "list_social_posts"],
  },
  reminders: {
    about: "Reminders and follow-ups",
    tools: ["add_reminder", "list_reminders", "cancel_reminder", "remind_me"],
  },
  system: {
    about: "Secrets, saved procedures and the machine itself",
    tools: ["save_secret", "recall_secret", "list_secrets", "learn_skill", "run_shell"],
  },
};

/** The toolset a tool belongs to, or "" when it is core. */
export function setOf(toolName: string): string {
  if ((CORE_TOOLS as readonly string[]).includes(toolName)) return "";
  for (const [id, set] of Object.entries(TOOLSETS)) {
    if (set.tools.includes(toolName)) return id;
  }
  return "";
}

/** One line per domain, for the model to choose from. */
export function toolsetIndex(): { name: string; about: string; tools: number }[] {
  return Object.entries(TOOLSETS).map(([name, s]) => ({
    name,
    about: s.about,
    tools: s.tools.length,
  }));
}
