import { supabase } from "./supabase";
import { assertWorkspaceCurrent, isLocalMode } from "./dataMode";
import { getCacheIdentity, getCacheOrg, getCacheScope } from "./api";
import { setOf } from "./toolsets";
import { ConnectionUnavailableError, isTransientConnectionError } from "./connectionError";

export interface ModuleAccess { admin: boolean; modules: string[] | null }
let pending: { scope: string; identity: number; promise: Promise<ModuleAccess> } | null = null;

/** No persisted permission cache: revocation or a failed lookup must not
 * authorize old cached records. Concurrent reads share only the in-flight RPC. */
export async function loadModuleAccess(): Promise<ModuleAccess> {
  assertWorkspaceCurrent();
  if (isLocalMode()) return {admin:true,modules:null};
  const scope = getCacheScope();
  const identity = getCacheIdentity();
  if (!scope || !supabase) throw new Error("Sign in to load workspace permissions.");
  if (pending?.scope === scope && pending.identity === identity) return pending.promise;
  const promise = (async () => {
    const { data, error, status } = await supabase.rpc("filey_module_access");
    assertWorkspaceCurrent();
    if (scope !== getCacheScope() || identity !== getCacheIdentity())
      throw new Error("Your workspace changed. Reopen this section.");
    if (error && isTransientConnectionError(error, status))
      throw new ConnectionUnavailableError("Workspace connection is unavailable. Your current task is preserved; reconnect to verify access.");
    if (error || !data || data.allowed !== true || typeof data.admin !== "boolean" ||
      (data.modules !== null && (!Array.isArray(data.modules) || data.modules.some((id: unknown) => typeof id !== "string"))))
      throw new Error("Workspace permissions could not be verified. Retry or contact your administrator.");
    // New servers bind permissions to the selected organization. Older servers
    // omit this field; after a revoked membership is repaired, personal admin
    // access must never authorize the previous team's cached records.
    if ("org_id" in data) {
      if (typeof data.org_id !== "string" || !data.org_id)
        throw new Error("Workspace permissions could not be verified. Retry or contact your administrator.");
      if (data.org_id !== getCacheOrg()) {
        if (typeof window !== "undefined") window.dispatchEvent(new Event("filey:cloud-change"));
        throw new Error("Your workspace changed. Filey is refreshing your account access.");
      }
    }
    return {admin:data.admin,modules:data.modules} as ModuleAccess;
  })();
  pending = {scope,identity,promise};
  try { return await promise; } finally { if (pending?.promise === promise) pending = null; }
}

export const canUseModule = (access: ModuleAccess, id: string): boolean =>
  access.admin || access.modules === null || access.modules.includes(id) || ["overview","agent","settings"].includes(id);

export async function requireModuleAccess(id: string, admin = false): Promise<void> {
  const access = await loadModuleAccess();
  if (!canUseModule(access,id) || admin && !access.admin) throw new Error(`Your workspace role does not permit this ${id} action.`);
}

const toolModules: Record<string,string> = {
  find_customers:"customers",create_customer:"customers",find_products:"inventory",create_product:"inventory",
  find_suppliers:"suppliers",create_supplier:"suppliers",financial_summary:"accounting",
  list_invoices:"invoicing",get_invoice:"invoicing",list_pending_invoice_saves:"invoicing",create_invoice_draft:"invoicing",revise_invoice:"invoicing",retry_invoice_save:"invoicing",
  create_quote:"quoting",list_templates:"invoicing",create_order:"orders",
  set_invoice_preset:"invoicing",list_packing_lists:"packaging-list",create_packing_list:"packaging-list",list_declaration_letters:"declaration",create_declaration_letter:"declaration",list_quotes:"quoting",list_orders:"orders",
  word:"letters",sheet:"letters",pdf:"letters",slides:"letters",design:"letters",fig:"letters",vector:"letters",get_letter_context:"letters",list_letters:"letters",get_letter:"letters",create_letter_draft:"letters",revise_letter_draft:"letters",export_letter_pdf:"letters",
  create_payment_receipt:"payment-receipts",list_payment_receipts:"payment-receipts",
  create_purchase_order:"purchase-orders",create_purchase_invoice_draft:"purchase-invoices",list_purchase_invoices:"purchase-invoices",
  list_bank_accounts:"bank-accounts",list_cheques:"cheques",record_cheque:"cheques",
  create_campaign:"marketing",list_campaigns:"marketing",list_email_templates:"email-templates",
  list_my_files:"files",use_saved_file:"files",run_file_tool:"letters",list_file_tools:"letters",read_attached_document:"files",
  list_purchase_orders:"purchase-orders",update_purchase_order_status:"purchase-orders",receive_purchase_order:"purchase-orders",
  list_follow_ups:"follow-ups",complete_follow_up:"follow-ups",
  save_bank_account:"bank-accounts",save_email_template:"email-templates",delete_email_template:"email-templates",
  update_customer:"customers",update_supplier:"suppliers",update_product:"inventory",update_order_status:"orders",
  update_cheque_status:"cheques",update_payment_receipt_status:"payment-receipts",
  create_employee:"people",update_employee:"people",mark_salary_paid:"people",list_attendance:"people",
  create_account:"accounting",post_journal_entry:"accounting",
  list_team_channels:"team",create_team_channel:"team",post_team_message:"team",
  list_comms_log:"comms",log_call:"comms",
  get_company_profile:"settings",
  // Wiring audit 2026-10-23: each tool sits in the module whose screen does the same thing.
  get_quote:"quoting",set_quote_status:"quoting",convert_quote_to_invoice:"invoicing",
  record_invoice_payment:"invoicing",list_invoice_payments:"invoicing",apply_advance_to_invoice:"invoicing",
  list_recurring:"invoicing",cancel_recurring:"invoicing",
  record_advance:"customers",list_advances:"customers",
  get_purchase_order:"purchase-orders",record_po_payment:"purchase-orders",reorder_low_stock:"purchase-orders",
  stock_history:"inventory",reschedule_follow_up:"follow-ups",add_crm_note:"crm",
};
const domains: Record<string,string> = { sales:"invoicing",inventory:"inventory",accounting:"accounting",crm:"crm",people:"people",logistics:"delivery-challans",messaging:"integrations",social:"marketing",reminders:"follow-ups" };
const ADMIN_TOOLS = new Set(["run_shell","computer_use","agent_computer","browser","workspace_browser","http_fetch",
  "list_users","create_user","set_user_active","update_company_profile"]);
/** Tools that belong to no business module: orientation, the agent's own
 *  memory and skills, public web/reference reads, and per-account secrets
 *  (credentialStore scopes those to the signed-in workspace already). Listed
 *  by name rather than inferred — an unplaced tool is refused below, and
 *  module-access-coverage.test.ts fails the build instead of the user. */
const MODULE_FREE = new Set([
  "get_stats","current_time","show_ui","show_openui","card_templates","find_image",
  "remember","recall","search_conversations",
  "list_skills","use_skill","run_skill_script","learn_skill","import_skill",
  "list_toolsets","use_toolset",
  "generate_image","work_service",
  // Personal AI-credit wallet; no business records or organization funds.
  "create_video_draft","list_video_jobs","get_video_job","cancel_video_job",
  "read_web_page","search_web","viking","enrich_company_website","find_prospects",
  "read_github","read_github_file","search_github","watch_youtube","read_rss","read_social_page",
  "save_secret","recall_secret","list_secrets",
  // The signed-in person's own notifications inbox.
  "list_notifications",
  // The agent's own standing jobs. Each run's tools are checked one by one.
  "create_automation","list_automations","update_automation",
]);
/** A link is a write into both sides, so it needs both modules. */
const ENTITY_MODULE: Record<string,string> = {
  invoice:"invoicing", quotation:"quoting", purchase_order:"purchase-orders",
  customer:"customers", supplier:"suppliers", product:"inventory",
  lead:"crm", follow_up:"follow-ups", receipt:"payment-receipts", expense:"accounting",
};

export async function requireToolModuleAccess(name: string, args: Record<string,unknown>): Promise<void> {
  const access = await loadModuleAccess();
  if (ADMIN_TOOLS.has(name)) {
    if (!access.admin) throw new Error("Only a workspace owner or administrator can use computer, shell or unrestricted network tools.");
    return; // admin rights are the gate for these; they belong to no module
  }
  const deny = (module: string) => { throw new Error(`Your workspace role does not have access to ${module}.`); };
  if ((name === "get_invoice" || name === "list_pending_invoice_saves") && args.doc_type === "purchase") {
    if (!canUseModule(access, "purchase-invoices")) deny("purchase-invoices");
    return;
  }
  if (name === "retry_invoice_save") {
    // The tool resolves the durable request and checks its actual document
    // module again before replaying; purchase-only roles must reach that check.
    if (!canUseModule(access, "invoicing") && !canUseModule(access, "purchase-invoices")) deny("invoicing");
    return;
  }
  // A conversion reads the quote and writes an invoice: both sides' modules.
  if (name === "convert_quote_to_invoice") {
    for (const module of ["quoting", "invoicing"]) if (!canUseModule(access, module)) deny(module);
    return;
  }
  // A supplier's advance lives with suppliers, a customer's with customers.
  if (name === "record_advance" || name === "list_advances") {
    const module = String(args.party).toLowerCase() === "supplier" ? "suppliers" : "customers";
    if (!canUseModule(access, module)) deny(module);
    return;
  }
  if (name === "link_records" || name === "find_links") {
    for (const value of [args.from_type,args.to_type,args.type]) {
      const module = typeof value === "string" ? ENTITY_MODULE[value] : undefined;
      if (module && !canUseModule(access,module)) deny(module);
    }
    return;
  }
  let module = toolModules[name] || domains[setOf(name)];
  // Navigation keeps the destination's permission boundary; a section placed
  // under Tools in the sidebar still has its own module ID (for example letters).
  if (name === "open_page") {
    module = typeof args.page === "string" ? args.page.trim().toLowerCase().replace(/^\/+/, "") : "";
    if (module === "office") module = "letters"; // Office work kept the Letters module id
  }
  if (name === "list_work_items" || name === "save_work_item") module = args.kind === "ticket" ? "helpdesk" : "projects";
  // Fail closed. An unmapped tool used to skip this gate entirely, so every
  // tool outside a domain toolset ran for members whose role denies the module.
  if (!module) {
    if (MODULE_FREE.has(name)) return;
    throw new Error(`${name} is not assigned to a workspace module. Ask your administrator to update Filey.`);
  }
  if (!canUseModule(access,module)) deny(module);
}

/** For the coverage test: every tool must be placed somewhere. */
export const moduleToolPlacement = (name: string): string | null =>
  ADMIN_TOOLS.has(name) ? "admin"
  : name === "open_page" ? "navigation"
  : MODULE_FREE.has(name) ? "module-free"
  : name === "link_records" || name === "find_links" ? "entity"
  : name === "list_work_items" || name === "save_work_item" ? "work-items"
  : toolModules[name] || domains[setOf(name)] || null;
