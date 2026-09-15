import { supabase } from "./supabase";
import { assertWorkspaceCurrent, isLocalMode } from "./dataMode";
import { getCacheScope } from "./api";
import { setOf } from "./toolsets";

export interface ModuleAccess { admin: boolean; modules: string[] | null }
let pending: { scope: string; promise: Promise<ModuleAccess> } | null = null;

/** No persisted permission cache: revocation or a failed lookup must not
 * authorize old cached records. Concurrent reads share only the in-flight RPC. */
export async function loadModuleAccess(): Promise<ModuleAccess> {
  assertWorkspaceCurrent();
  if (isLocalMode()) return {admin:true,modules:null};
  const scope = getCacheScope();
  if (!scope || !supabase) throw new Error("Sign in to load workspace permissions.");
  if (pending?.scope === scope) return pending.promise;
  const promise = (async () => {
    const { data, error } = await supabase.rpc("filey_module_access");
    assertWorkspaceCurrent();
    if (scope !== getCacheScope()) throw new Error("Your workspace changed. Reopen this section.");
    if (error || !data || data.allowed !== true || typeof data.admin !== "boolean" ||
      (data.modules !== null && (!Array.isArray(data.modules) || data.modules.some((id: unknown) => typeof id !== "string"))))
      throw new Error("Workspace permissions could not be verified. Retry or contact your administrator.");
    return {admin:data.admin,modules:data.modules} as ModuleAccess;
  })();
  pending = {scope,promise};
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
  list_invoices:"invoicing",create_invoice_draft:"invoicing",revise_invoice:"invoicing",
  create_quote:"quoting",list_templates:"invoicing",create_order:"orders",
  create_payment_receipt:"payment-receipts",list_payment_receipts:"payment-receipts",
  create_purchase_order:"purchase-orders",create_purchase_invoice_draft:"purchase-invoices",list_purchase_invoices:"purchase-invoices",
  list_bank_accounts:"bank-accounts",list_cheques:"cheques",record_cheque:"cheques",
  create_campaign:"marketing",list_campaigns:"marketing",list_email_templates:"email-templates",
  list_my_files:"files",use_saved_file:"files",run_file_tool:"tools",list_file_tools:"tools",read_attached_document:"tools",
};
const domains: Record<string,string> = { sales:"invoicing",inventory:"inventory",accounting:"accounting",crm:"crm",people:"people",logistics:"delivery-challans",messaging:"integrations",social:"marketing",reminders:"follow-ups" };
const ADMIN_TOOLS = new Set(["run_shell","computer_use","browser","workspace_browser","http_fetch"]);
/** Tools that belong to no business module: orientation, the agent's own
 *  memory and skills, public web/reference reads, and per-account secrets
 *  (credentialStore scopes those to the signed-in workspace already). Listed
 *  by name rather than inferred — an unplaced tool is refused below, and
 *  module-access-coverage.test.ts fails the build instead of the user. */
const MODULE_FREE = new Set([
  "get_stats","current_time","open_page",
  "remember","recall",
  "list_skills","use_skill","learn_skill","import_skill",
  "list_toolsets","use_toolset",
  "generate_image","work_service",
  "read_web_page","search_web","enrich_company_website","find_prospects",
  "read_github","read_github_file","search_github","watch_youtube","read_rss","read_social_page",
  "save_secret","recall_secret","list_secrets",
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
  if (name === "link_records" || name === "find_links") {
    for (const value of [args.from_type,args.to_type,args.type]) {
      const module = typeof value === "string" ? ENTITY_MODULE[value] : undefined;
      if (module && !canUseModule(access,module)) deny(module);
    }
    return;
  }
  let module = toolModules[name] || domains[setOf(name)];
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
  : MODULE_FREE.has(name) ? "module-free"
  : name === "link_records" || name === "find_links" ? "entity"
  : name === "list_work_items" || name === "save_work_item" ? "work-items"
  : toolModules[name] || domains[setOf(name)] || null;
