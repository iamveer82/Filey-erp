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
  "get_invoice",
  "financial_summary",
  // the documents people ask for by name
  "create_invoice_draft",
  // Correcting a draft is as everyday as making one, and keeping it out of the
  // core set is what makes an agent produce a second invoice instead of fixing
  // the first.
  "revise_invoice",
  "create_quote",
  "create_customer",
  "list_templates",
  // memory and procedure
  "remember",
  "recall",
  "search_conversations",
  "list_skills",
  "use_skill",
  // reach for more
  "list_toolsets",
  "use_toolset",
  // A real terminal is part of the desk, not a domain to unlock: "open
  // Explorer", "run this repo", "check the build" must not need a toolset round.
  "run_shell",
] as const;

/** Everything else, by the domain a person would name. */
export const TOOLSETS: Record<string, { about: string; tools: string[] }> = {
  letters: {
    about: "Office work: Word, Sheets, PDF, Slides, Designs, letters",
    tools: ["word", "sheet", "pdf", "slides", "design", "fig", "vector", "get_letter_context", "get_letter", "create_letter_draft", "revise_letter_draft", "list_letters", "export_letter_pdf"],
  },
  cards: {
    about: "Cards, charts, tables, KPIs in chat",
    tools: ["show_ui", "show_openui", "card_templates", "find_image"],
  },
  video: {
    about: "Brand videos from a brief or photo; track jobs",
    tools: ["create_video_draft", "list_video_jobs", "get_video_job", "cancel_video_job"],
  },
  service: {
    about: "Projects, tasks, time entries, support tickets",
    tools: ["list_work_items", "save_work_item"],
  },
  sales: {
    about: "Invoices, quotes, orders, receipts, PDFs",
    tools: [
      "list_pending_invoice_saves",
      "retry_invoice_save",
      "send_invoice",
      "export_invoice_pdf",
      "email_invoice",
      "mark_invoice_paid",
      "set_recurring",
      "set_invoice_template",
      "update_invoice_appearance",
      "set_invoice_preset",
      "create_order",
      "list_orders",
      "update_order_status",
      "list_quotes",
      "get_quote",
      "set_quote_status",
      "convert_quote_to_invoice",
      "record_invoice_payment",
      "list_invoice_payments",
      "record_advance",
      "list_advances",
      "apply_advance_to_invoice",
      "list_recurring",
      "cancel_recurring",
      "create_payment_receipt",
      "list_payment_receipts",
      "update_payment_receipt_status",
      "share_document_link",
    ],
  },
  purchasing: {
    about: "Purchase orders, supplier bills, suppliers, VAT letters",
    tools: [
      "create_declaration_letter",
      "list_declaration_letters",
      "create_purchase_order",
      "list_purchase_orders",
      "get_purchase_order",
      "update_purchase_order_status",
      "receive_purchase_order",
      "record_po_payment",
      "create_purchase_invoice_draft",
      "list_purchase_invoices",
      "create_supplier",
      "update_supplier",
    ],
  },
  links: {
    about: "Which quote became an invoice; join records",
    tools: ["find_links", "link_records"],
  },
  inventory: {
    about: "Products, stock levels, adjustments",
    tools: ["create_product", "update_product", "adjust_stock", "stock_history", "reorder_low_stock"],
  },
  logistics: {
    about: "Delivery challans, GRNs, returns, packing lists",
    tools: ["create_delivery_challan", "list_delivery_challans", "create_packing_list", "list_packing_lists"],
  },
  accounting: {
    about: "Ledger, VAT, cheques, banks, expenses, ageing",
    tools: [
      "log_expense",
      "list_expenses",
      "list_transactions",
      "create_account",
      "post_journal_entry",
      "list_bank_accounts",
      "save_bank_account",
      "list_cheques",
      "record_cheque",
      "update_cheque_status",
      "financial_statements",
      "receivables_aging",
      "payables_aging",
      "vat_return",
    ],
  },
  crm: {
    about: "Leads, deals, pipeline, contacts, activities",
    tools: [
      "create_lead",
      "find_leads",
      "create_deal",
      "set_deal_stage",
      "list_deals",
      "crm_pipeline",
      "crm_records",
      "save_crm_record",
      "convert_lead",
      "log_activity",
      "list_activities",
      "get_deal_contacts",
      "set_deal_contact",
      "score_lead",
      "update_customer",
      "add_crm_note",
    ],
  },
  people: {
    about: "Employees, attendance, payroll, WPS",
    tools: [
      "list_employees",
      "create_employee",
      "update_employee",
      "mark_attendance",
      "list_attendance",
      "get_attendance_today",
      "run_payroll",
      "list_payroll",
      "mark_salary_paid",
      "generate_wps_file",
    ],
  },
  files: {
    about: "Read, edit, convert files; saved files",
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
    about: "Email, WhatsApp, connected apps, campaigns",
    tools: [
      "send_gmail",
      "send_whatsapp",
      "send_whatsapp_file",
      "send_invoice_whatsapp",
      "prepare_invoice_whatsapp",
      "list_whatsapp_messages",
      "connect_whatsapp",
      "list_channels",
      "send_to_channel",
      "composio_run",
      "list_connected_apps",
      "list_email_templates",
      "save_email_template",
      "delete_email_template",
      "create_campaign",
      "list_campaigns",
    ],
  },
  team: {
    about: "Team channels and the comms log",
    tools: [
      "list_team_channels",
      "create_team_channel",
      "post_team_message",
      "list_comms_log",
      "log_call",
    ],
  },
  admin: {
    about: "Company details and workspace users",
    tools: [
      "get_company_profile",
      "update_company_profile",
      "list_users",
      "create_user",
      "set_user_active",
    ],
  },
  web: {
    about: "Market data, web research, Filey browser",
    tools: [
      "read_web_page",
      "search_web",
      "viking",
      "http_fetch",
      "enrich_company_website",
      "find_prospects",
      "browser",
      "workspace_browser",
      "work_service",
      "read_github",
      "read_github_file",
      "search_github",
      "watch_youtube",
      "read_rss",
      "read_social_page",
    ],
  },
  computer: {
    about: "Agent browser, or operate Windows apps",
    tools: ["computer_use", "agent_computer"],
  },
  social: {
    about: "Post and schedule to social accounts",
    tools: ["list_social_accounts", "schedule_social_post", "list_social_posts"],
  },
  reminders: {
    about: "Reminders and automations",
    tools: ["add_reminder", "list_reminders", "cancel_reminder", "remind_me", "list_follow_ups", "complete_follow_up", "reschedule_follow_up", "list_notifications", "create_automation", "list_automations", "update_automation"],
  },
  skills: {
    about: "Instagram, YouTube, LinkedIn scripts",
    tools: ["run_skill_script"],
  },
  system: {
    about: "Secrets, procedures, the machine",
    tools: [
      "save_secret",
      "recall_secret",
      "list_secrets",
      "learn_skill",
      "import_skill",
    ],
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
