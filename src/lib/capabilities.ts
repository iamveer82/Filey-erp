/* Agent capabilities ("plugins") — toggle groups of write/action tools on/off.
 * runTool() blocks any tool whose group is disabled. Read-only tools (stats,
 * search, lists, navigation, memory, skills) are always allowed and aren't
 * listed here.
 */

export interface Capability {
  id: string;
  name: string;
  description: string;
  /** Tool names (from aiTools TOOLS) gated by this capability. */
  tools: string[];
}

export const CAPABILITIES: Capability[] = [
  {
    id: "sales",
    name: "Sales documents",
    description: "Create/send invoices & quotes, mark paid, recurring, orders",
    tools: [
      "create_invoice_draft",
      "revise_invoice",
      "send_invoice",
      "mark_invoice_paid",
      "set_recurring",
      "create_order",
      "create_quote",
    ],
  },
  {
    id: "purchasing",
    name: "Purchasing",
    description: "Create purchase orders",
    tools: ["create_purchase_order"],
  },
  {
    id: "inventory",
    name: "Inventory",
    description: "Add products, adjust stock levels",
    tools: ["create_product", "adjust_stock"],
  },
  {
    id: "expenses",
    name: "Expenses",
    description: "Log expenses to accounting",
    tools: ["log_expense"],
  },
  {
    id: "crm",
    name: "Customers",
    description: "Add customer records",
    tools: ["create_customer"],
  },
  {
    id: "hr",
    name: "People & attendance",
    description: "Mark employee attendance",
    tools: ["mark_attendance"],
  },
  {
    id: "files",
    name: "File tools",
    description: "Edit/convert/read attached PDFs & images",
    tools: ["run_file_tool", "read_attached_document"],
  },
  {
    id: "email",
    name: "Email",
    description: "Email invoices to customers (SMTP)",
    tools: ["email_invoice"],
  },
  {
    id: "channels",
    name: "Messaging (Composio)",
    description: "Send via connected Gmail / Slack / Telegram, and share document links",
    tools: [
      "send_gmail",
      "composio_run",
      "share_document_link",
      "connect_whatsapp",
      "send_whatsapp",
    ],
  },
  {
    id: "reminders",
    name: "Reminders",
    description: "Add follow-up reminders",
    tools: ["add_reminder"],
  },
  {
    // A saved skill is replayed into every later prompt, so writing one changes
    // how the agent behaves from then on. That makes it a write with an unusually
    // long tail: a instruction injected from a scanned document could teach a
    // standing habit rather than just a one-off action. Grouping it means Manual
    // and Plan mode gate it like any other change.
    id: "self",
    name: "Self-improvement",
    description: "Let the agent save procedures it works out as reusable skills",
    tools: ["learn_skill"],
  },
  {
    id: "web",
    name: "Web research",
    description: "Read and search public web pages, enrich leads from their own site",
    tools: [
      "read_web_page",
      "search_web",
      "enrich_company_website",
      "find_prospects",
      "score_lead",
    ],
  },
  {
    id: "social",
    name: "Social publishing",
    description: "Post and schedule to your connected social accounts (Zernio)",
    tools: ["list_social_accounts", "schedule_social_post", "list_social_posts"],
  },
];

const KEY = "filey.agent.capabilities";

/** id → enabled. Absent = enabled (default on). */
type CapState = Record<string, boolean>;

function load(): CapState {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CapState) : {};
  } catch {
    return {};
  }
}

export function isCapabilityEnabled(id: string): boolean {
  return load()[id] !== false; // default on
}

export function setCapabilityEnabled(id: string, enabled: boolean): void {
  const state = load();
  state[id] = enabled;
  localStorage.setItem(KEY, JSON.stringify(state));
}

/** Is this tool permitted? Ungrouped tools (reads, nav, memory, skills) always
 *  allowed; grouped tools follow their capability toggle. */
export function isToolAllowed(toolName: string): boolean {
  const cap = CAPABILITIES.find((c) => c.tools.includes(toolName));
  return cap ? isCapabilityEnabled(cap.id) : true;
}

/** Does this tool change anything? Only write/action tools are grouped above,
 *  so being in a group is what makes a tool a write — this saves flagging every
 *  read tool by hand. Used by the agent modes (see agentMode.ts). */
export function isWriteTool(toolName: string): boolean {
  return CAPABILITIES.some((c) => c.tools.includes(toolName));
}
