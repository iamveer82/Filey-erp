/* Filey as an MCP server for the owner's other agents (their own Hermes, Claude Desktop, any MCP
 * client). The desktop host (src-tauri/src/modules/mcp_server.rs) accepts the connection on
 * 127.0.0.1 with a bearer token and hands each request here.
 *
 * Two tools, the same pair Filey's own agent uses: filey_tools finds an action, filey_run runs it
 * through runTool, so permissions, capability switches and numbering are the app's. Sensitive
 * actions (sending, paying) always wait for the owner's Approve in Filey, whatever the agent mode;
 * owner-only tools (shell, computer control) are not offered to outside agents. */
import { fileyToolCatalog } from "./fileyAgent";
import { confirmInApp, endTurn, runTool, type ConfirmFn } from "./aiTools";
import { notifyOwner } from "./alwaysOn";
import { hasTauri } from "./localPaths";

const KEY = "filey.mcp.enabled";
export interface McpStatus { enabled: boolean; url: string; token: string }

export const mcpEnabled = (): boolean => {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
};

const TOOLS = [
  {
    name: "filey_tools",
    description: "List the Filey ERP actions on this computer's Filey app (invoices, quotes, purchase orders, payments, customers, suppliers, products and stock, accounting, VAT, payroll, CRM, letters, documents, reminders, messaging). Call with `query` (words or a phrase, e.g. 'overdue invoices') to find candidates, then with `name` for that action's exact parameters before filey_run. Use these for any business data; never invent figures or records.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words or a phrase describing what you want to do." },
        name: { type: "string", description: "Exact action name: returns its parameter schema." },
      },
    },
  },
  {
    name: "filey_run",
    description: "Run one Filey ERP action by exact name with arguments matching its schema from filey_tools. Writes happen in the owner's real workspace; sending and paying wait for the owner to approve in Filey. Report the figures the result returns. If a save is unconfirmed, read the record back before retrying; never create duplicates.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Exact action name from filey_tools, e.g. create_invoice_draft." },
        args: { type: "object", description: "Arguments for that action." },
      },
      required: ["name", "args"],
    },
  },
];

/** Outside agents always ask, and the owner hears about it even with Filey in the tray. */
const askOwner: ConfirmFn = (name, args) => {
  void notifyOwner("Your agent needs your OK in Filey", name.replace(/_/g, " "));
  return confirmInApp(name, args);
};

async function call(params: { name?: unknown; arguments?: Record<string, unknown> }): Promise<unknown> {
  const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
  if (params.name === "filey_tools")
    return fileyToolCatalog(typeof args.name === "string" ? args.name : undefined, typeof args.query === "string" ? args.query : undefined);
  if (params.name !== "filey_run") throw new Error(`Unknown tool: ${String(params.name)}`);
  let toolArgs: unknown = args.args ?? {};
  if (typeof toolArgs === "string") toolArgs = toolArgs.trim() ? JSON.parse(toolArgs) : {};
  if (!toolArgs || typeof toolArgs !== "object" || Array.isArray(toolArgs)) return { error: "args must be a JSON object." };
  const turnId = `mcp-${crypto.randomUUID()}`;
  try {
    // isOwner false: shell and computer control stay with the agents Filey runs itself.
    const out = await runTool(String(args.name ?? ""), toolArgs as Record<string, unknown>, askOwner, false, turnId, undefined, undefined, "mcp");
    const files = endTurn(turnId);
    return files.length && out && typeof out === "object" ? { ...(out as object), files } : out;
  } finally {
    endTurn(turnId);
  }
}

/** The JSON-RPC result for one forwarded MCP request (tools/list or tools/call). */
export async function mcpResponse(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    if (method === "tools/list") return { result: { tools: TOOLS } };
    const out = await call(params);
    const isError = !!(out && typeof out === "object" && "error" in out);
    return { result: { content: [{ type: "text", text: JSON.stringify(out ?? null) }], isError } };
  } catch (error) {
    return { result: { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true } };
  }
}

async function answer(id: number, method: string, params: Record<string, unknown>) {
  const response = await mcpResponse(method, params);
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("filey_mcp_respond", { id, response }).catch(() => {});
}

async function configure(enabled: boolean): Promise<McpStatus> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<McpStatus>("filey_mcp_configure", { enabled });
}

export async function setMcpEnabled(enabled: boolean): Promise<McpStatus> {
  const status = await configure(enabled);
  try { localStorage.setItem(KEY, enabled ? "1" : "0"); } catch { /* remembered for this run only */ }
  return status;
}

export async function rotateMcpToken(): Promise<McpStatus> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<McpStatus>("filey_mcp_rotate_token");
}

/** Read the address and token without changing anything. */
export const mcpStatus = (): Promise<McpStatus> => configure(mcpEnabled());

let started = false;
/** Mount once at boot on the desktop app: answer forwarded requests; reopen if it was on. */
export async function startMcpBridge(): Promise<void> {
  if (started || !hasTauri) return;
  started = true;
  const { listen } = await import("@tauri-apps/api/event");
  await listen<{ id: number; method: string; params?: Record<string, unknown> }>("filey-mcp-request", e => {
    void answer(e.payload.id, e.payload.method, e.payload.params ?? {});
  });
  if (mcpEnabled()) await configure(true).catch(error => console.warn("Filey MCP server did not start.", error));
}
