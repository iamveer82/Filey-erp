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
  /** Explicit read tools may be disabled without turning lookups into writes. */
  readOnlyTools?: string[];
}

export const CAPABILITIES: Capability[] = [
  {
    id: "video",
    name: "Brand videos",
    description: "Prepare video quotes and check jobs. Paid generation always needs your Generate click.",
    tools: ["create_video_draft", "cancel_video_job", "get_video_job", "list_video_jobs"],
    readOnlyTools: ["get_video_job", "list_video_jobs"],
  },
  {
    id: "computer",
    name: "Computer use",
    description:
      "Use the built-in browser and Windows apps during Filey AI tasks",
    tools: ["computer_use", "workspace_browser"],
  },
  {
    id: "agent_computers",
    name: "Agent computers (optional)",
    description: "Give each conversation its own browser workspace for bot tasks. Off by default; requires Computer use and the Windows app. No Docker or separate operating system.",
    tools: ["agent_computer"],
  },
  {
    id: "service",
    name: "Projects & helpdesk",
    description:
      "Create and update delivery projects, tasks, time entries and support tickets",
    tools: ["save_work_item"],
  },
  {
    id: "sales",
    name: "Sales documents",
    description: "Create/send invoices & quotes, mark paid, recurring, orders, templates",
    tools: [
      "create_invoice_draft",
      "revise_invoice",
      "send_invoice",
      "export_invoice_pdf",
      "mark_invoice_paid",
      "set_recurring",
      "create_order",
      "create_quote",
      "set_invoice_template",
      "update_invoice_appearance",
    ],
  },
  {
    id: "links",
    name: "Record links",
    description:
      "Read how records connect, and join two of them up — which quote became an invoice, what a customer generated",
    // find_links only reads, but it belongs to the same capability as the
    // write so a mode that grants one grants the pair; link_records must be
    // here or it would mutate the graph even in Plan mode.
    tools: ["find_links", "link_records"],
  },
  {
    id: "purchasing",
    name: "Purchasing",
    description: "Create purchase orders, supplier bills and supplier records",
    tools: ["create_purchase_order", "create_purchase_invoice_draft", "create_supplier"],
  },
  {
    id: "logistics",
    name: "Delivery challans",
    description: "Create delivery challans, goods received notes and returns",
    tools: ["create_delivery_challan"],
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
    name: "Customers & CRM",
    description: "Add customer records, deals, leads and activity notes",
    tools: [
      "create_customer",
      "create_deal",
      "set_deal_stage",
      "set_deal_contact",
      "log_activity",
      "create_lead",
      "save_crm_record",
      "convert_lead",
    ],
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
    description: "Email invoices to customers through Resend",
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
      "send_whatsapp_file",
      "send_invoice_whatsapp",
      "prepare_invoice_whatsapp",
    ],
  },
  {
    id: "reminders",
    name: "Reminders",
    description: "Add and cancel follow-up reminders",
    tools: ["add_reminder", "remind_me", "cancel_reminder"],
  },
  {
    id: "marketing",
    name: "Marketing",
    description: "Draft marketing campaigns (sending stays a human decision)",
    tools: ["create_campaign"],
  },
  {
    id: "cheques",
    name: "Cheque register",
    description: "Record issued and received cheques in the register",
    tools: ["record_cheque"],
  },
  {
    // A saved skill is replayed into every later prompt, so writing one changes
    // how the agent behaves from then on. That makes it a write with an unusually
    // long tail: a instruction injected from a scanned document could teach a
    // standing habit rather than just a one-off action. Grouping it means Manual
    // and Plan mode gate it like any other change.
    id: "self",
    name: "Self-improvement",
    description:
      "Let the agent save procedures it works out, and install skills from repos",
    tools: ["learn_skill", "import_skill"],
  },
  {
    id: "web",
    name: "Web research",
    description: "Read and search public web pages, enrich leads from their own site",
    readOnlyTools: ["work_service"],
    tools: [
      "read_web_page",
      "work_service",
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

import { readAgentStorage, writeAgentStorage } from "./agentStorage";
const KEY = "filey.agent.capabilities";

/** id → enabled. Agent computers require an explicit workspace opt-in. */
type CapState = Record<string, boolean>;

function load(): CapState {
  let restrictive: CapState = {};
  try {
    const legacy = JSON.parse(localStorage.getItem(KEY) || "{}");
    if (legacy && typeof legacy === "object" && !Array.isArray(legacy))
      restrictive = Object.fromEntries(
        Object.entries(legacy).filter(([, enabled]) => enabled === false)
      ) as CapState;
  } catch {
    /* A malformed legacy value grants no permissions. */
  }
  try {
    const scoped = JSON.parse(readAgentStorage(KEY) || "{}");
    if (scoped && typeof scoped === "object" && !Array.isArray(scoped))
      return {
        ...restrictive,
        ...Object.fromEntries(
          Object.entries(scoped).filter(
            (entry): entry is [string, boolean] => typeof entry[1] === "boolean"
          )
        ),
      };
  } catch {
    /* Keep legacy restrictions until an explicit workspace choice. */
  }
  return restrictive;
}

export function isCapabilityEnabled(id: string): boolean {
  return load()[id] ?? (id !== "agent_computers");
}

export function setCapabilityEnabled(id: string, enabled: boolean): void {
  const state = load();
  state[id] = enabled;
  writeAgentStorage(KEY, JSON.stringify(state));
}

/** Is this tool permitted? Ungrouped tools (reads, nav, memory, skills) always
 *  allowed; grouped tools follow their capability toggle. */
export function isToolAllowed(toolName: string): boolean {
  if (toolName === "agent_computer" && !isCapabilityEnabled("computer")) return false;
  const cap = CAPABILITIES.find((c) => c.tools.includes(toolName));
  return cap ? isCapabilityEnabled(cap.id) : true;
}

/** Does this tool change anything? Only write/action tools are grouped above,
 *  so being in a group is what makes a tool a write — this saves flagging every
 *  read tool by hand. Used by the agent modes (see agentMode.ts). */
export function isWriteTool(toolName: string): boolean {
  return CAPABILITIES.some(
    (c) => c.tools.includes(toolName) && !c.readOnlyTools?.includes(toolName)
  );
}
