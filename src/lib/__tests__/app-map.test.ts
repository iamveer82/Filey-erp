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
      ["write an NOC letter for Ahmed", "create_letter_draft"],
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
      ["سوي عرض تقديمي للشركة", "slides"],
    ];
    for (const [text, tool] of cases) expect(toolsForRequest(text), text).toContain(tool);
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
