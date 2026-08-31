// Local → cloud push list: app data only, in FK-safe order (parents before
// children). Cloud/system tables (profiles, organizations, notifications,
// tool_jobs…) are excluded — the cloud owns those. Shared by the one-time
// migration (migrate.ts) and the continuous auto-sync (sync.ts, localdb
// journal), so a new table added here is picked up by both.
export const PUSH_TABLES = [
  "company_profile",
  "app_settings",
  "suppliers",
  "crm_customers",
  "products",
  "orders",
  "order_items",
  "invoice_docs",
  "invoice_doc_items",
  "invoice_payments",
  "invoice_recurrence",
  "quotations",
  "quotation_items",
  "quotation_templates",
  "purchase_orders",
  "purchase_order_items",
  "po_payments",
  "payment_receipts",
  "accounts",
  "expenses",
  "transactions",
  "advances",
  "stock_movements",
  "employees",
  "attendance",
  "payroll",
  "crm_leads",
  // people before the deals that reference them, deals before their notes/tasks
  "crm_people",
  "crm_opportunities",
  "crm_activities",
  "crm_notes",
  "crm_tasks",
  "follow_ups",
  // Edges reference rows in other tables, so they sync after them.
  "entity_links",
  // Channels before the messages that name them.
  "org_channels",
  "org_messages",
  "email_messages",
  "call_logs",
  "tool_runs",
  "user_folders",
  "user_files",
  "user_assets",
  // Opt-outs sync before campaigns: a device that has the campaign but not the
  // suppression list must never be the one that sends.
  "email_optouts",
  "campaigns",
];

export const PUSH_SET = new Set(PUSH_TABLES);
