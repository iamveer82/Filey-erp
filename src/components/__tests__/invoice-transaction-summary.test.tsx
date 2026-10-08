import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DocView, { type DocViewForm } from "../DocView";
import { templatesForDocType } from "../DocTemplates";
import { TRANSACTION_TYPE_FLAGS } from "../../lib/einvoice";
import type { CustomTemplate } from "../TemplateDesigner";
import InvoiceExportSheet from "../InvoiceExportSheet";
import { EMPTY_BANK } from "../BankDetails";

it("prints only selected transaction details once on the final page of every invoice layout", () => {
  const form: DocViewForm = {
    currency: "AED", tax_country_code: "AE", number: "INV-DEMO-1",
    seller_name: "Demo Studio", customer_name: "Demo Customer",
    transaction_type: "10000001", items: [{ description: "Design", qty: 1, unit_price: 100 }],
  };
  const custom: CustomTemplate = {
    id: "custom-demo", name: "Demo letterhead", type: "file", layout: "minimal",
    accent: "#222222", font: "sans-serif", paperSize: "A4", fileType: "image",
    fileData: "data:image/png;base64,aGVsbG8=", positions: { footer: { x: 6, y: 88 } },
    showLogo: true, showSeller: true, showCustomer: true, showNotes: false, showTerms: false, showTax: true,
  };
  const templates = [...templatesForDocType("invoice").map(t => ({ id: t.id, custom: undefined as CustomTemplate | undefined })),
    { id: custom.id, custom }, { id: "custom-builder", custom: { ...custom, id: "custom-builder", type: "builder" as const } }];
  for (const template of templates) {
    const section = (overrides: Partial<DocViewForm> = {}, showFooter = true) => {
      const page = document.createElement("div");
      page.innerHTML = renderToStaticMarkup(<DocView form={{ ...form, template: template.id, ...overrides }} customTemplate={template.custom} showFooter={showFooter} />);
      return page.querySelectorAll("[data-invoice-transactions]");
    };
    const printed = section();
    expect(printed, template.id).toHaveLength(1);
    expect(printed[0].textContent).toBe("Transaction details: Free Trade zone · Exports");
    expect(section({ transaction_type: "00000000" }), template.id).toHaveLength(0);
    expect(section({ transaction_type: undefined }), template.id).toHaveLength(0);
    expect(section({}, false), template.id).toHaveLength(0);
    expect(section({ tax_country_code: "IN" }), template.id).toHaveLength(0);
    const all = section({ transaction_type: "11111111", currency: "USD" });
    for (const flag of TRANSACTION_TYPE_FLAGS) expect(all[0].textContent, template.id).toContain(flag.label);
    const metadata = document.createElement("div");
    const ordinaryForm = { ...form, template: template.id, transaction_type: undefined, invoice_type_code: "380", payment_means_code: "30" };
    metadata.innerHTML = renderToStaticMarkup(<DocView form={ordinaryForm} customTemplate={template.custom} />);
    expect(metadata.querySelector("[data-invoice-payment]")?.textContent, template.id).toBe("Invoice type: 380 (Tax invoice) · Payment: 30 (Credit transfer)");
    expect(metadata.querySelector("[data-invoice-transactions]"), template.id).toBeNull();
    expect(renderToStaticMarkup(<DocView form={ordinaryForm} customTemplate={template.custom} showFooter={false} />), template.id).not.toContain("data-invoice-payment");
  }
  const pdf = document.createElement("div");
  pdf.innerHTML = renderToStaticMarkup(<InvoiceExportSheet form={{ ...form, accent: "#222222", template: "corporate", items: [form.items[0], { ...form.items[0], pageBreakBefore: true }] }} bank={EMPTY_BANK} />);
  const pages = pdf.querySelectorAll(".invoice-print:not([data-einvoice-details-sheet])");
  expect(pages).toHaveLength(2);
  expect(pages[0].querySelector("[data-invoice-transactions]")).toBeNull();
  expect(pages[1].querySelector("[data-invoice-transactions]")?.textContent).toContain("Free Trade zone · Exports");
});
