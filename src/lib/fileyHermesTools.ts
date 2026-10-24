/* Filey tools Filey Agent (Hermes) gets as its OWN tools, not behind filey_tools/filey_run.
 *
 * Behind the catalogue, Hermes reached for what sat in its own tool list instead: its terminal
 * and Python to edit a PDF, its headless browser (not installed) to "use the computer". These
 * are the actions people ask for by name — Office work, the computer, files, the core books — so
 * they ride in the engine's tool list directly. Everything else stays one filey_tools lookup away.
 *
 * agent/tools/filey_app_manifest.json is generated from this list and the app's own schemas
 * (filey-hermes-manifest.test.ts fails when it drifts; run it with WRITE_FILEY_MANIFEST=1). */
import { TOOLS } from "./aiTools";

/** App tool name → the name Hermes knows it by (renamed only where Hermes has its own tool). */
export const HERMES_NATIVE_TOOLS: Record<string, string> = {
  word: "word", sheet: "sheet", pdf: "pdf", slides: "slides", design: "design", fig: "fig", vector: "vector",
  computer_use: "filey_computer", agent_computer: "agent_computer", workspace_browser: "workspace_browser",
  open_page: "open_page", show_ui: "show_ui",
  list_my_files: "list_my_files", use_saved_file: "use_saved_file", read_attached_document: "read_attached_document",
  list_file_tools: "list_file_tools", run_file_tool: "run_file_tool",
  get_stats: "get_stats", financial_summary: "financial_summary",
  find_customers: "find_customers", find_products: "find_products",
  list_invoices: "list_invoices", get_invoice: "get_invoice", create_invoice_draft: "create_invoice_draft",
  export_invoice_pdf: "export_invoice_pdf", create_quote: "create_quote", create_letter_draft: "create_letter_draft",
};

/** Hermes name → app name, for showing the real action in the chat. */
export const APP_NAME_FOR: Record<string, string> = Object.fromEntries(
  Object.entries(HERMES_NATIVE_TOOLS).map(([app, hermes]) => [hermes, app]),
);

export function hermesManifest() {
  return Object.entries(HERMES_NATIVE_TOOLS).map(([name, hermes_name]) => {
    const tool = TOOLS.find(t => t.name === name);
    if (!tool) throw new Error(`${name} is not a Filey tool`);
    return { hermes_name, name, description: tool.description, parameters: tool.parameters };
  });
}
