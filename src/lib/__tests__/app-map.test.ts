import { describe, expect, it } from "vitest";
import { APP_MAP, APP_MAP_EXEMPT, appMapPrompt, toolsForRequest } from "../appMap";
import { TOOLS } from "../aiTools";
import { MODULES } from "../../modules/registry";
import { todayNote } from "../ai";

describe("the agent's app map", () => {
  it("places every section of the app", () => {
    const pages = new Set(APP_MAP.map(a => a.page));
    const page = (to: string) => to.replace(/^\//, "") === "office" ? "office" : to.replace(/^\//, "");
    const missing = MODULES.filter(m => !APP_MAP_EXEMPT.includes(m.id) && !pages.has(page(m.to)) && !pages.has(m.id)).map(m => m.id);
    expect(missing).toEqual([]);
  });

  it("names only tools that exist", () => {
    const names = new Set(TOOLS.map(t => t.name));
    expect(APP_MAP.flatMap(a => a.tools).filter(t => !names.has(t))).toEqual([]);
  });

  it("routes what people say, in English and Arabic, to the right tool", () => {
    const cases: [string, string][] = [
      ["make a payment voucher for 500 from Ali", "create_payment_receipt"],
      ["receipt for 5000 from Al Noor via bank transfer", "create_payment_receipt"],
      ["سوي سند صرف بمبلغ 500 درهم", "create_payment_receipt"],
      ["اعمل سند قبض لعلي", "create_payment_receipt"],
      ["ابي وصل لمحمد", "create_payment_receipt"],
      ["create a delivery note for Rennox", "create_delivery_challan"],
      ["raise an LPO to Bapco for 20 drums", "create_purchase_order"],
      ["record this supplier bill", "create_purchase_invoice_draft"],
      ["log 120 for fuel as an expense", "log_expense"],
      ["فاتورة جديدة للعميل", "create_invoice_draft"],
      ["send a quotation for 3 pails", "create_quote"],
      ["run payroll for October", "run_payroll"],
      ["who owes me money", "receivables_aging"],
      ["record a post-dated cheque", "record_cheque"],
      ["write an NOC letter for Ahmed", "word"],
      ["salary certificate for Bhawani", "word"],
      ["open budget.xlsx", "sheet"],
      ["sign the contract pdf", "pdf"],
      ["merge these two pdfs", "run_file_tool"],
      ["remind me tomorrow to call Ali", "add_reminder"],
      ["prepare the VAT return", "vat_return"],
      ["make a packing list for Rennox, 48 pails", "create_packing_list"],
      ["declaration letter to Bapco for LPO 2231", "create_declaration_letter"],
      ["show my open quotes", "list_quotes"],
      ["list sales orders for Rennox", "list_orders"],
      ["make a presentation about our Q3 sales", "slides"],
      ["design a flyer for the new product", "design"],
      ["wireframe the app screens", "fig"],
      ["draw a logo for Rennox", "vector"],
      ["open the file I saved", "word"],
      ["post this update in Slack", "composio_run"],
      ["send a message on Microsoft Teams", "list_connected_apps"],
      ["reply in the Discord channel", "composio_run"],
      ["سوي عرض تقديمي للشركة", "slides"],
      ["write landing page copy for the new product", "create_campaign"],
      ["run an seo audit on the site", "list_campaigns"],
    ];
    for (const [text, tool] of cases) expect(toolsForRequest(text), text).toContain(tool);
  });

  it("understands short, everyday requests without the section's name", () => {
    const cases: [string, string][] = [
      ["bill ahmed 500", "create_invoice_draft"],
      ["charge rennox for 20 pails", "create_invoice_draft"],
      ["inv 23 paid in full", "mark_invoice_paid"],
      ["ali paid 500", "create_payment_receipt"],
      ["got 2000 cash from bapco", "create_payment_receipt"],
      ["fuel 200", "log_expense"],
      ["rent paid", "log_expense"],
      ["bought 10 drums from bapco", "create_purchase_invoice_draft"],
      ["order 20 drums from bapco", "create_purchase_order"],
      ["sara joined today", "create_employee"],
      ["ravi absent", "mark_attendance"],
      ["who hasn't paid", "receivables_aging"],
      ["how much did we sell this month", "financial_summary"],
      ["sales today", "get_stats"],
      ["how many pails left", "find_products"],
      ["dispatch it to rennox", "create_delivery_challan"],
      ["don't forget to call ali", "add_reminder"],
      ["msg him the invoice", "send_invoice_whatsapp"],
      ["mail it to ali", "email_invoice"],
      ["بعت لعلي ١٠ كراتين", "create_invoice_draft"],
      ["علي غائب اليوم", "mark_attendance"],
    ];
    for (const [text, tool] of cases) expect(toolsForRequest(text), text).toContain(tool);
    // What the screens could do and the agent could not, until the 2026-10-23 wiring audit.
    for (const [text, tool] of [
      ["they accepted Q-0012, invoice it", "convert_quote_to_invoice"],
      ["mark the quote to rennox as sent", "set_quote_status"],
      ["ali paid 500 of INV-0023", "record_invoice_payment"],
      ["paid bapco 2000 for PO-0012", "record_po_payment"],
      ["rennox gave a 5000 deposit", "record_advance"],
      ["use rennox's advance on invoice 31", "apply_advance_to_invoice"],
      ["stop the monthly invoice for rennox", "cancel_recurring"],
      ["postpone the call with ali to friday", "reschedule_follow_up"],
      ["note on rennox: prefers monday deliveries", "add_crm_note"],
      ["anything new?", "list_notifications"],
    ] as const) expect(toolsForRequest(text), text).toContain(tool);
    // Money spent and a customer's order stay where they belong.
    expect(toolsForRequest("i paid 200 for fuel")).not.toContain("create_payment_receipt");
    expect(toolsForRequest("got an order from ali")).not.toContain("create_purchase_order");
  });

  it("does not turn a receipt or voucher into a letter or an invoice", () => {
    for (const text of ["make a payment voucher for 500 from Ali", "سوي سند صرف بمبلغ 500 درهم"]) {
      expect(toolsForRequest(text), text).not.toContain("create_letter_draft");
      expect(toolsForRequest(text), text).not.toContain("create_invoice_draft");
    }
  });

  it("keeps the prompt map short", () => {
    expect(appMapPrompt().length).toBeLessThan(3_400);
    expect(appMapPrompt()).toContain("Payment Receipts: receipt / receipt voucher / payment voucher");
  });

  it("tells the agent today's date", () => {
    expect(todayNote(new Date(2026, 9, 16, 9))).toContain("Friday, 16 October 2026");
  });
});
