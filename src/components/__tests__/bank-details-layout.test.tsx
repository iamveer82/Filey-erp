import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BankDetailsBlock, EMPTY_BANK } from "../BankDetails";
import InvoiceExportSheet from "../InvoiceExportSheet";
import { templatesForDocType } from "../DocTemplates";
import DocView from "../DocView";
import type { CustomTemplate } from "../TemplateDesigner";

it("places country-specific bank details after notes on the final page of every invoice layout", () => {
  const bank = { ...EMPTY_BANK, bank_name: "Demo Bank", account_name: "Demo Studio", account_number: "1234567890", iban: "AE070331234567890123456", ifsc: "HDFC0001234" };
  const page = document.createElement("div");
  const templates = [...new Map(["invoice", "quote", "po"].flatMap(type => templatesForDocType(type as "invoice" | "quote" | "po")).map(template => [template.id, template])).values()];
  for (const template of templates) {
    page.innerHTML = renderToStaticMarkup(<InvoiceExportSheet bank={bank} form={{
      template: template.id, currency: "AED", tax_country_code: "AE", number: "DEMO-1", show_bank: true,
      notes: "Please use the invoice number as your payment reference.",
      items: [{ description: "Design", qty: 1, unit_price: 100 }, { description: "Review", qty: 1, unit_price: 50, pageBreakBefore: true }],
    }} />);
    const pages = page.querySelectorAll(".invoice-print:not([data-einvoice-details-sheet])");
    expect(pages).toHaveLength(2);
    expect(pages[0].querySelector("[data-bank-details]")).toBeNull();
    const block = pages[1].querySelector("[data-bank-details]")!;
    expect(block.textContent, template.id).toContain(bank.iban);
    expect(block.textContent).not.toContain(bank.ifsc);
    expect(block.closest('[style*="position: absolute"]'), template.id).toBeNull();
    expect(pages[1].innerHTML.indexOf("Please use the invoice number"), template.id).toBeLessThan(pages[1].innerHTML.indexOf("data-bank-details"));
    expect(block.querySelector("dl")).not.toBeNull();
    expect(block.querySelector("dt")?.textContent).toBe("Bank Name");
  }
  page.innerHTML = renderToStaticMarkup(<BankDetailsBlock bank={bank} countryCode="IN" />);
  expect(page.textContent).toContain("IFSC Code");
  expect(page.textContent).not.toContain("IBAN");
  expect(renderToStaticMarkup(<BankDetailsBlock bank={{ ...EMPTY_BANK, iban: bank.iban }} countryCode="IN" />)).toBe("");
});

it("keeps bank details below notes in custom builder and uploaded templates", () => {
  const bank = { ...EMPTY_BANK, bank_name: "Demo Bank", account_number: "1234567890" };
  const form = { template: "custom-bank", items: [], notes: "Payment reference", tax_country_code: "AE" };
  const custom: CustomTemplate = { id: form.template, name: "Custom", type: "builder", layout: "minimal", accent: "#222222", font: "Inter", paperSize: "A4", showLogo: true, showSeller: true, showCustomer: true, showNotes: true, showTerms: true, showTax: true };
  const page = document.createElement("div");
  for (const template of [custom, { ...custom, type: "file" as const, fileData: "data:image/png;base64,demo", fileType: "image" as const, positions: { footer: { x: 6, y: 88 } } }]) {
    expect(renderToStaticMarkup(<DocView form={form} bank={bank} customTemplate={template} showFooter={false} />)).not.toContain("data-bank-details");
    page.innerHTML = renderToStaticMarkup(<DocView form={form} bank={bank} customTemplate={template} />);
    const block = page.querySelector("[data-bank-details]")!;
    expect(page.innerHTML.indexOf(form.notes)).toBeLessThan(page.innerHTML.indexOf("data-bank-details"));
    expect(block).not.toBeNull();
    if (template.type === "file") {
      expect(block.parentElement?.style.bottom).toBe("3%");
      expect(block.parentElement?.style.top).toBe("");
    }
  }
});

it("omits bank details when disabled and keeps them visible when notes are empty", () => {
  const bank = { ...EMPTY_BANK, bank_name: "Demo Bank", account_number: "1234567890" };
  const form = { template: "corporate", items: [], notes: "", show_bank: false };
  expect(renderToStaticMarkup(<InvoiceExportSheet bank={bank} form={form} />)).not.toContain("data-bank-details");
  expect(renderToStaticMarkup(<InvoiceExportSheet bank={bank} form={{ ...form, show_bank: true }} />)).toContain("data-bank-details");
});
