import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BankDetailsBlock, EMPTY_BANK } from "../BankDetails";
import InvoiceExportSheet from "../InvoiceExportSheet";
import { templatesForDocType } from "../DocTemplates";

it("prints country-specific bank details only on the final page and preserves document positioning", () => {
  const bank = { ...EMPTY_BANK, bank_name: "Demo Bank", account_name: "Demo Studio", account_number: "1234567890", iban: "AE070331234567890123456", ifsc: "HDFC0001234" };
  const page = document.createElement("div");
  for (const template of templatesForDocType("invoice")) {
    page.innerHTML = renderToStaticMarkup(<InvoiceExportSheet bank={bank} form={{
      template: template.id, currency: "AED", tax_country_code: "AE", number: "DEMO-1", show_bank: true,
      items: [{ description: "Design", qty: 1, unit_price: 100 }, { description: "Review", qty: 1, unit_price: 50, pageBreakBefore: true }],
    }} />);
    const pages = page.querySelectorAll(".invoice-print");
    expect(pages).toHaveLength(2);
    expect(pages[0].querySelector("[data-bank-details]")).toBeNull();
    const block = pages[1].querySelector("[data-bank-details]")!;
    expect(block.textContent, template.id).toContain(bank.iban);
    expect(block.textContent).not.toContain(bank.ifsc);
    expect(block.parentElement?.style.position).toBe("absolute");
    expect(block.querySelector("dl")).not.toBeNull();
    expect(block.querySelector("dt")?.textContent).toBe("Bank Name");
  }
  page.innerHTML = renderToStaticMarkup(<BankDetailsBlock bank={bank} countryCode="IN" />);
  expect(page.textContent).toContain("IFSC Code");
  expect(page.textContent).not.toContain("IBAN");
  expect(renderToStaticMarkup(<BankDetailsBlock bank={{ ...EMPTY_BANK, iban: bank.iban }} countryCode="IN" />)).toBe("");
});
