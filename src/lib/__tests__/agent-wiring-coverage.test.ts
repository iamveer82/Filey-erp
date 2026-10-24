// Every operation the app's screens can perform (the data-layer namespaces in api.ts)
// must either be reached by the agent or be left out ON PURPOSE, with the reason here.
//
// The section test checks each sidebar section has a read and a write; that still let
// whole actions go missing. The 2026-10-23 audit found the agent could create a quote
// but not convert it, mark an invoice paid but not record a part payment, and had no
// way at all to pay a supplier or use an advance. Nothing failed. Now a new data-layer
// operation fails this test until someone wires it or writes down why not.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest runs from the repository root; import.meta.url is not a file URL under jsdom.
const lib = join(process.cwd(), "src", "lib");
const read = (name: string) => readFileSync(join(lib, name), "utf8");

/** namespace -> operations, as declared in `export const X = { ... }` blocks of api.ts. */
function dataLayer(): Map<string, string[]> {
  const spaces = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of read("api.ts").split("\n")) {
    const open = line.match(/^export const (\w+) = \{/);
    if (open) { current = open[1]; spaces.set(current, []); continue; }
    if (current && /^\};?\s*$/.test(line)) { current = null; continue; }
    const op = current && line.match(/^ {2}(?:async\s+)?([a-zA-Z_]\w*)\s*(?:\(|:\s*(?:async\s*)?(?:\(|function|<))/);
    if (op) spaces.get(current!)!.push(op[1]);
  }
  return spaces;
}

/** Everything the agent runs: the tool table and the agent-side modules it calls into. */
const agentCode = readdirSync(lib)
  .filter(f => /^(aiTools|agent\w*|ai[A-Z]\w*|appMap|computerUse|desktopBrowser|officeWord|work\w*)\.tsx?$/.test(f))
  .map(read)
  .join("\n");

const DELETE = "deleting stays a deliberate click in the app's screens, where it can be seen and undone";
const SHARE = "share_document_link covers sending a link; member sharing and revoking stay in the document screen";
const INTERNAL = "internal plumbing, not a user action";
const INBOX = "read state belongs to the person viewing; the agent reads without marking anything";
const ADMIN = "workspace membership, roles and invites are security settings the owner changes in Settings; list_users, create_user and set_user_active cover the roster";
const BULK = "bulk CSV import in the screens; the agent creates records one at a time";
const CRM_RECORD = "reached through save_crm_record / log_activity (crmWorkspace.saveCrmRecord), not by this name";
const SCREEN = "a screen-only edit; the agent's tools cover the everyday version of this action";

const LEFT_OUT: Record<string, string> = {
  workflowRetry: "a settings object, not operations",
  org: ADMIN,
  toolRuns: INTERNAL,
  "erp.createProducts": BULK,
  "erp.recordStockEntry": "adjust_stock records single stock changes",
  "erp.recordStocktake": "adjust_stock records counted corrections; full stocktakes run on the Inventory screen",
  "erp.deleteProduct": DELETE,
  "erp.deleteProducts": DELETE,
  "erp.createOrderWithItems": "create_order records the order; orders with item lines are entered on the Orders screen",
  "erp.updateOrder": "update_order_status (erp.setOrderStatus) moves an order; other order edits stay on the screen",
  "erp.deleteOrder": DELETE,
  "erp.getOrder": "list_orders returns the order fields the agent needs",
  "erp.shareOrder": SHARE,
  "erp.summary": "get_stats and financial_summary give the dashboard numbers",
  "hr.setEmployeeStatus": "update_employee sets status through hr.updateEmployee",
  "hr.deleteEmployee": DELETE,
  "hr.markPayrollPaid": "mark_salary_paid uses hr.setPayrollPaid",
  "hr.summary": "list_employees and list_payroll give the same figures",
  "fin.updateAccount": SCREEN,
  "fin.deleteAccount": DELETE,
  "fin.deleteExpense": DELETE,
  "fin.markReconciled": "bank lines are matched on the Bank Accounts screen",
  "fin.updateTransaction": SCREEN,
  "fin.deleteTransaction": DELETE,
  "fin.repairLedger": INTERNAL,
  "fin.getExpense": "list_expenses returns expense details",
  "tools.logAction": INTERNAL,
  "tools.auditLog": INTERNAL,
  "crm.setLeadStatus": CRM_RECORD,
  "crm.deleteLead": DELETE,
  "crm.createCustomers": BULK,
  "crm.deleteCustomer": DELETE,
  "crm.addOptOut": "marketing consent is changed by the person or on the Marketing screen, never by the agent",
  "crm.removeOptOut": "marketing consent is changed by the person or on the Marketing screen, never by the agent",
  "crm.optOuts": "the Marketing screen applies opt-outs when a campaign is sent",
  "crm.optOutsStrict": "the Marketing screen applies opt-outs when a campaign is sent",
  "crm.updateCampaign": "create_campaign drafts; editing and sending a campaign stay a human decision",
  "crm.deleteCampaign": DELETE,
  "crm.createOpportunity": CRM_RECORD,
  "crm.deleteOpportunity": DELETE,
  "crm.createActivity": CRM_RECORD,
  "crm.toggleActivity": CRM_RECORD,
  "crm.createPerson": CRM_RECORD,
  "crm.updatePerson": CRM_RECORD,
  "crm.deletePerson": DELETE,
  "crm.updateNote": SCREEN,
  "crm.deleteNote": DELETE,
  "crm.addTask": "log_activity records tasks as CRM activities",
  "crm.updateTask": "log_activity records tasks as CRM activities",
  "crm.setTaskDone": "log_activity records tasks as CRM activities",
  "crm.deleteTask": DELETE,
  "crm.notes": "crm_records shows a record with its notes",
  "crm.backfillLinks": INTERNAL,
  "followups.remove": DELETE,
  "billing.deleteDoc": DELETE,
  "billing.removePayment": DELETE,
  "billing.shareDoc": SHARE,
  "billing.shareWithMembers": SHARE,
  "billing.sharingState": SHARE,
  "billing.publicLink": SHARE,
  "billing.revokePublicLink": SHARE,
  "billing.allPayments": "list_invoice_payments per invoice; receivables_aging for the whole book",
  "recurrences.generateDue": "the scheduler makes due invoices; the agent sets and cancels repeats",
  "quotes.saveDoc": "create_quote calls it imported as quoteApi",
  "quotes.deleteDoc": DELETE,
  "quotes.deleteDocs": DELETE,
  "quotes.shareDoc": SHARE,
  "quotes.publicLink": SHARE,
  "quotes.revokePublicLink": SHARE,
  quoteTemplates: "quote layout presets are managed on the Quoting screen",
  "suppliers.remove": DELETE,
  "pos.remove": DELETE,
  "pos.removePayment": DELETE,
  "pos.shareDoc": SHARE,
  "pos.publicLink": SHARE,
  "pos.revokePublicLink": SHARE,
  "pos.allPayments": "get_purchase_order per PO; payables_aging for the whole book",
  "advances.remove": DELETE,
  "advances.update": SCREEN,
  "advances.list": "list_advances reads one party's ledger",
  "advances.creditFor": "list_advances sums the same ledger",
  "receipts.delete": DELETE,
  "receipts.get": "list_payment_receipts returns receipt details",
  "receipts.shareDoc": SHARE,
  "receipts.publicLink": SHARE,
  "receipts.revokePublicLink": SHARE,
  "messages.markRead": INBOX,
  "messages.remove": DELETE,
  "messages.page": INBOX,
  "messages.thread": INBOX,
  "messages.unread": INBOX,
  "messages.unreadDirect": INBOX,
  "messages.list": INBOX,
  "notifs.markRead": INBOX,
  "notifs.markAllRead": INBOX,
  "links.remove": DELETE,
  "links.search": "find_links searches links",
  "channels.remove": DELETE,
  "emailLog.record": "send tools log their own email",
  "emailLog.forEntity": "list_comms_log reads the log",
  "callLog.remove": DELETE,
  "callLog.forEntity": "list_comms_log reads the log",
};

const reached = (ns: string, op: string) => new RegExp(`\\b${ns}\\s*\\.\\s*${op}\\b`).test(agentCode);
const leftOut = (ns: string, op: string) => LEFT_OUT[ns] ?? LEFT_OUT[`${ns}.${op}`];

describe("the agent reaches everything the screens can do", () => {
  const spaces = dataLayer();

  it("finds the data layer", () => {
    expect(spaces.get("billing")).toContain("addPayment");
    expect(spaces.get("quotes")).toContain("convertToInvoice");
  });

  it("wires every operation or says why it is left out", () => {
    const unexplained = [...spaces].flatMap(([ns, ops]) => ops.filter(op => !reached(ns, op) && !leftOut(ns, op)).map(op => `${ns}.${op}`));
    expect(unexplained, "wire these into an agent tool, or add them to LEFT_OUT with the reason").toEqual([]);
  });

  it("keeps the left-out list honest: nothing listed is wired or gone", () => {
    const stale = Object.keys(LEFT_OUT).filter(key => {
      const [ns, op] = key.split(".");
      const ops = spaces.get(ns);
      if (!ops) return true;
      return op ? !ops.includes(op) || reached(ns, op) : false;
    });
    expect(stale, "these are wired now or no longer exist; remove them from LEFT_OUT").toEqual([]);
  });
});
